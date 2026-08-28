/**
 * Sherpa-ONNX speech synthesis worker.
 *
 * Synthesis is CPU-heavy and bursty — a long sentence through a VITS vocoder
 * will happily block a thread for a few hundred milliseconds. Running it here
 * keeps that entirely off the main thread, so the interface never freezes at
 * the exact moment the user is trying to say something.
 *
 * Returns raw Float32 PCM, which the main thread wraps in an AudioBuffer and
 * routes through the TTS bus to both the speakers and the peer connection.
 */

/* eslint-disable no-undef */

const DEFAULT_ENTRIES = {
  helper: 'sherpa-onnx-tts.js',
  glue: 'sherpa-onnx-wasm-main-tts.js',
  factory: 'createOfflineTts',
};

let wasmModule = null;
let tts = null;
let ready = false;
let cancelled = false;

function post(message, transfer) {
  self.postMessage(message, transfer ?? []);
}

function reportStatus(status, detail, extra) {
  post({ type: 'status', status, detail, ...extra });
}

function heapBytes() {
  try {
    return wasmModule?.HEAPU8?.byteLength ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Bundle shapes.
 *
 * Sherpa ships two incompatible layouts and gives no version signal to tell
 * them apart:
 *
 *   classic  — the helper and the Emscripten glue are plain scripts that read a
 *              pre-existing global `Module`. Loaded with importScripts.
 *   module   — built with MODULARIZE=1: the glue is an ES module whose default
 *              export is an async factory, and the helper exports its functions.
 *              Loaded with dynamic import.
 *
 * The main thread sniffs the glue for `export` and spawns this worker as
 * `module` or `classic` accordingly, then passes the answer in. A module worker
 * has no importScripts and a classic one cannot statically import, so the
 * decision has to be made before the worker exists.
 */
async function loadRuntime(base, entries, isModule) {
  const locateFile = (path) => `${base}/${path}`;
  const print = (text) => post({ type: 'log', level: 'info', text });
  const printErr = (text) => post({ type: 'log', level: 'error', text });
  const setStatus = (text) => {
    if (text) post({ type: 'progress', text });
  };

  if (isModule) {
    let helper;
    let glue;
    try {
      [helper, glue] = await Promise.all([
        import(/* @vite-ignore */ `${base}/${entries.helper}`),
        import(/* @vite-ignore */ `${base}/${entries.glue}`),
      ]);
    } catch (error) {
      throw new Error(
        `Could not import the Sherpa-ONNX bundle from "${base}". ` +
          `Run \`npm run fetch:models\` or check the URL. (${error?.message ?? error})`,
      );
    }

    const factory = glue.default ?? glue.Module;
    if (typeof factory !== 'function') {
      throw new Error('The Sherpa module bundle has no default export to instantiate.');
    }

    // The factory resolves once the runtime is initialised, so there is no
    // onRuntimeInitialized callback to wait on in this shape.
    const instance = await factory({ locateFile, print, printErr, setStatus });
    return { instance, exports: helper };
  }

  const instance = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Sherpa WebAssembly runtime did not initialise within 120 s.'));
    }, 120_000);

    self.Module = {
      locateFile,
      print,
      printErr,
      setStatus,
      onRuntimeInitialized: () => {
        clearTimeout(timeout);
        resolve(self.Module);
      },
      onAbort: (reason) => {
        clearTimeout(timeout);
        reject(new Error(`Sherpa WebAssembly aborted: ${reason}`));
      },
    };

    try {
      // The helper defines the factory; the glue instantiates the runtime.
      importScripts(`${base}/${entries.helper}`);
      importScripts(`${base}/${entries.glue}`);
    } catch (error) {
      clearTimeout(timeout);
      reject(
        new Error(
          `Could not load the Sherpa-ONNX bundle from "${base}". ` +
            `Run \`npm run fetch:models\` or check the URL. (${error?.message ?? error})`,
        ),
      );
    }
  });

  return { instance, exports: self };
}

function resolveExport(scope, name) {
  const candidate = scope?.[name] ?? wasmModule?.[name];
  if (typeof candidate !== 'function') {
    const available = Object.keys(scope ?? {})
      .filter((key) => key.startsWith('create'))
      .join(', ') || 'none';
    throw new Error(`Sherpa TTS bundle does not export "${name}". Found: ${available}.`);
  }
  return candidate;
}

async function init(payload) {
  const base = String(payload.base ?? '').replace(/\/+$/, '');
  const entries = { ...DEFAULT_ENTRIES, ...(payload.entries ?? {}) };

  reportStatus('loading', `Loading synthesis voice from ${base}`);

  const { instance, exports } = await loadRuntime(base, entries, payload.moduleBundle === true);
  wasmModule = instance;
  const factory = resolveExport(exports, entries.factory);
  tts = payload.config ? factory(wasmModule, payload.config) : factory(wasmModule);

  ready = true;
  reportStatus('ready', 'Sherpa-ONNX synthesis initialised', {
    heapBytes: heapBytes(),
    sampleRate: tts.sampleRate ?? 22050,
    numSpeakers: tts.numSpeakers ?? 1,
  });
}

function synthesize(payload) {
  if (!ready) throw new Error('Synthesis engine is not ready.');
  cancelled = false;

  const started = Date.now();
  const generated = tts.generate({
    text: payload.text,
    sid: payload.speakerId ?? 0,
    speed: payload.rate ?? 1.0,
  });

  if (cancelled) {
    post({ type: 'cancelled', requestId: payload.requestId });
    return;
  }

  // Copy out of the WASM heap: the underlying buffer may be reused or freed.
  const samples = new Float32Array(generated.samples.length);
  samples.set(generated.samples);

  post(
    {
      type: 'audio',
      requestId: payload.requestId,
      samples,
      sampleRate: generated.sampleRate ?? tts.sampleRate ?? 22050,
      elapsedMs: Date.now() - started,
    },
    [samples.buffer],
  );
}

self.onmessage = async (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;

  try {
    switch (message.type) {
      case 'init':
        await init(message);
        break;

      case 'synthesize':
        synthesize(message);
        break;

      case 'cancel':
        cancelled = true;
        break;

      case 'heap':
        post({ type: 'heap', bytes: heapBytes() });
        break;

      case 'dispose':
        if (tts && typeof tts.free === 'function') tts.free();
        tts = null;
        ready = false;
        post({ type: 'disposed' });
        self.close();
        break;

      default:
        break;
    }
  } catch (error) {
    reportStatus('error', error?.message ?? String(error), { requestId: message.requestId });
  }
};
