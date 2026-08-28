/**
 * Sherpa-ONNX speech recognition worker.
 *
 * A classic worker, deliberately: the Emscripten glue that ships with
 * Sherpa-ONNX is a non-module script that expects a pre-existing global
 * `Module`, which is exactly what `importScripts` gives us. Trying to coax it
 * through a bundler costs more than it buys.
 *
 * Supports both bundle shapes:
 *   • streaming  — Zipformer transducer, partial hypotheses as you speak.
 *   • offline    — SenseVoice / Whisper class, decoded per VAD-delimited
 *                  utterance. Slower to first word, better punctuation.
 *
 * No audio ever leaves this worker. It has no network access after
 * initialisation and never constructs a request carrying sample data.
 */

/* eslint-disable no-undef */

const DEFAULT_ENTRIES = {
  streaming: {
    helper: 'sherpa-onnx-asr.js',
    glue: 'sherpa-onnx-wasm-main-asr.js',
    factory: 'createOnlineRecognizer',
  },
  offline: {
    helper: 'sherpa-onnx-asr.js',
    glue: 'sherpa-onnx-wasm-main-asr.js',
    // The offline path ships as a class, not a factory (see `buildRecognizer`).
    factory: 'OfflineRecognizer',
  },
};

/** Streams are per-channel: the user and the remote peer decode independently. */
const channels = new Map();

let wasmModule = null;
let recognizer = null;
let mode = 'streaming';
let sampleRate = 16000;
let ready = false;

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
 * Load the Emscripten runtime. `locateFile` is what points the glue at the
 * sibling `.wasm` and `.data` files when they are not served from the worker's
 * own directory.
 */
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
    const available =
      Object.keys(scope ?? {})
        .filter((key) => key.startsWith('create') || key.endsWith('Recognizer'))
        .join(', ') || 'none';
    throw new Error(
      `Sherpa bundle does not export "${name}". Found in scope: ${available}. ` +
        'The bundle may be a different build variant than expected.',
    );
  }
  return candidate;
}

/**
 * The two decoding paths are exported differently by the upstream helper:
 * streaming as `createOnlineRecognizer(Module, config?)`, offline as an
 * `OfflineRecognizer` class taking `(config, Module)`. Called with no config,
 * the streaming factory uses the paths baked into the packaged `.data` archive,
 * which is what makes a stock release bundle work with no wiring.
 */
function buildRecognizer(scope, mode, entries, userConfig) {
  if (mode === 'streaming') {
    const factory = resolveExport(scope, entries.factory);
    return userConfig ? factory(wasmModule, userConfig) : factory(wasmModule);
  }

  // Some builds expose a factory as well; prefer it when present.
  const factory = scope?.createOfflineRecognizer ?? wasmModule?.createOfflineRecognizer;
  if (typeof factory === 'function') {
    return userConfig ? factory(wasmModule, userConfig) : factory(wasmModule);
  }

  const OfflineRecognizer = resolveExport(scope, entries.factory);
  if (!userConfig) {
    throw new Error(
      'Offline recognition needs an explicit model configuration. ' +
        'Set VITE_SHERPA_REFINE_BASE and supply a config, or use streaming mode.',
    );
  }
  return new OfflineRecognizer(userConfig, wasmModule);
}

function channelState(channel) {
  let state = channels.get(channel);
  if (!state) {
    state = { stream: null, lastText: '', pending: [], pendingLength: 0 };
    channels.set(channel, state);
  }
  return state;
}

function ensureStream(state) {
  if (!state.stream) state.stream = recognizer.createStream();
  return state.stream;
}

function freeStream(state) {
  if (state.stream && typeof state.stream.free === 'function') {
    try {
      state.stream.free();
    } catch {
      /* Already released. */
    }
  }
  state.stream = null;
}

// ---------------------------------------------------------------------------
// Streaming decode path
// ---------------------------------------------------------------------------


/**
 * Token-level evidence for the words just recognised.
 *
 * The transducer reports a log-probability per emitted token (`ys_probs`).
 * They ride along on final results so the interface can mark words the
 * decoder itself was unsure about. Absent on models that do not report them;
 * the interface treats that as "no marking", never as an error.
 */
function tokenEvidence(result) {
  const tokens = result && Array.isArray(result.tokens) ? result.tokens : null;
  const probs = result && Array.isArray(result.ys_probs) ? result.ys_probs : null;
  if (!tokens || !probs || tokens.length === 0 || tokens.length !== probs.length) {
    return { tokens: null, tokenLogProbs: null };
  }
  return { tokens, tokenLogProbs: probs };
}

function handleStreamingFrame(channel, samples) {
  const state = channelState(channel);
  const stream = ensureStream(state);

  stream.acceptWaveform(sampleRate, samples);
  while (recognizer.isReady(stream)) recognizer.decode(stream);

  const endpoint = typeof recognizer.isEndpoint === 'function' && recognizer.isEndpoint(stream);
  const result = recognizer.getResult(stream);
  const text = result?.text ?? '';

  if (endpoint) {
    if (text.trim().length > 0) {
      post({
        type: 'result',
        channel,
        text: text.trim(),
        final: true,
        timestamp: Date.now(),
        ...tokenEvidence(result),
      });
    }
    recognizer.reset(stream);
    state.lastText = '';
    return;
  }

  if (text !== state.lastText) {
    state.lastText = text;
    post({ type: 'result', channel, text, final: false, timestamp: Date.now() });
  }
}

/** The VAD said the utterance ended; emit whatever the decoder is holding. */
function flushStreaming(channel) {
  const state = channelState(channel);
  if (!state.stream) return;

  // Tail padding lets the transducer emit its final tokens rather than
  // stranding the last word in the encoder.
  state.stream.acceptWaveform(sampleRate, new Float32Array(Math.round(sampleRate * 0.3)));
  while (recognizer.isReady(state.stream)) recognizer.decode(state.stream);

  const result = recognizer.getResult(state.stream);
  const text = (result?.text ?? '').trim();
  if (text.length > 0) {
    post({ type: 'result', channel, text, final: true, timestamp: Date.now(), ...tokenEvidence(result) });
  }
  recognizer.reset(state.stream);
  state.lastText = '';
}

// ---------------------------------------------------------------------------
// Offline decode path — buffered per utterance, decoded on flush
// ---------------------------------------------------------------------------

const MAX_UTTERANCE_SECONDS = 30;

function handleOfflineFrame(channel, samples) {
  const state = channelState(channel);
  const limit = MAX_UTTERANCE_SECONDS * sampleRate;

  state.pending.push(samples);
  state.pendingLength += samples.length;

  // A stuck VAD must not grow the buffer without bound; decode and restart.
  if (state.pendingLength >= limit) flushOffline(channel);
}

function flushOffline(channel) {
  const state = channelState(channel);
  if (state.pendingLength === 0) return;

  const merged = new Float32Array(state.pendingLength);
  let offset = 0;
  for (const chunk of state.pending) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  state.pending = [];
  state.pendingLength = 0;

  const stream = recognizer.createStream();
  try {
    stream.acceptWaveform(sampleRate, merged);
    recognizer.decode(stream);
    const result = recognizer.getResult(stream);
    const text = (result?.text ?? '').trim();
    if (text.length > 0) {
      post({ type: 'result', channel, text, final: true, timestamp: Date.now(), ...tokenEvidence(result) });
    }
  } finally {
    if (typeof stream.free === 'function') stream.free();
  }
}

// ---------------------------------------------------------------------------

async function init(payload) {
  const base = String(payload.base ?? '').replace(/\/+$/, '');
  mode = payload.mode === 'offline' ? 'offline' : 'streaming';
  const entries = { ...DEFAULT_ENTRIES[mode], ...(payload.entries ?? {}) };

  reportStatus('loading', `Loading ${mode} recogniser from ${base}`);

  const { instance, exports } = await loadRuntime(base, entries, payload.moduleBundle === true);
  wasmModule = instance;
  recognizer = buildRecognizer(exports, mode, entries, payload.config);

  sampleRate =
    recognizer?.config?.featConfig?.sampleRate ??
    recognizer?.config?.featureConfig?.sampleRate ??
    16000;

  ready = true;
  reportStatus('ready', `Sherpa-ONNX ${mode} recogniser initialised`, {
    heapBytes: heapBytes(),
    sampleRate,
    streaming: mode === 'streaming',
  });
}

self.onmessage = async (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;

  try {
    switch (message.type) {
      case 'init':
        await init(message);
        break;

      case 'frame': {
        if (!ready) return;
        const samples = message.samples;
        if (mode === 'streaming') handleStreamingFrame(message.channel, samples);
        else handleOfflineFrame(message.channel, samples);
        break;
      }

      case 'flush':
        if (!ready) return;
        if (mode === 'streaming') flushStreaming(message.channel);
        else flushOffline(message.channel);
        break;

      case 'reset': {
        if (!ready) return;
        const state = channelState(message.channel);
        if (mode === 'streaming' && state.stream) recognizer.reset(state.stream);
        state.pending = [];
        state.pendingLength = 0;
        state.lastText = '';
        break;
      }

      case 'heap':
        post({ type: 'heap', bytes: heapBytes() });
        break;

      case 'dispose': {
        for (const state of channels.values()) freeStream(state);
        channels.clear();
        if (recognizer && typeof recognizer.free === 'function') recognizer.free();
        recognizer = null;
        ready = false;
        post({ type: 'disposed' });
        self.close();
        break;
      }

      default:
        break;
    }
  } catch (error) {
    reportStatus('error', error?.message ?? String(error));
  }
};
