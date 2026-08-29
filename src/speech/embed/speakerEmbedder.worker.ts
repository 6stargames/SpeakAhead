/// <reference lib="webworker" />
// The wasm-only build, deliberately: the default bundle includes the WebGPU
// backend and loads its `jsep` runtime files, which we do not ship — the
// symptom was "no available backend" and a silent fall back to heuristics.
import * as ort from 'onnxruntime-web/wasm';
import { FBANK_BINS, kaldiFbank } from '@/speech/fbank';

/**
 * The speaker-embedding worker: raw utterance audio in, a 512-dimensional
 * voiceprint out, produced by a CAM++ speaker-verification network trained
 * on VoxCeleb. Runs in a worker because inference takes tens to hundreds of
 * milliseconds, and the main thread is busy being a communication device.
 *
 * Everything stays in this worker's memory. The audio and the voiceprint —
 * the biometric BIPA protects — never touch the network; the only fetch here
 * is the model weights themselves, from our own origin, cache-first.
 */

// The `onnxruntime-web/wasm` bundle embeds its JS loader, so the only runtime
// asset is the wasm binary itself, served from public/ort/ (see
// scripts/copy-ort-assets.mjs) and cached offline by the *.wasm runtime rule.
// Only the wasm key is set: a directory here would force the loader to be
// fetched externally too, which Vite refuses to serve as a module in dev.
ort.env.wasm.wasmPaths = { wasm: '/ort/ort-wasm-simd-threaded.wasm' };
ort.env.wasm.numThreads = 1;

type Request =
  | { type: 'load'; modelUrl: string }
  | { type: 'embed'; id: number; samples: Float32Array; sampleRate: number };

type Response =
  | { type: 'ready'; runtime: 'coep-v1' }
  | { type: 'load-error'; message: string }
  | { type: 'embedding'; id: number; embedding: Float32Array | null };

const post = (message: Response, transfer: Transferable[] = []): void => {
  (self as unknown as Worker).postMessage(message, transfer);
};

let session: ort.InferenceSession | null = null;
let loading: Promise<void> | null = null;

async function load(modelUrl: string): Promise<void> {
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${modelUrl}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
}

/** The network expects 16 kHz; resample linearly if the graph runs elsewhere. */
function to16k(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === 16000) return samples;
  const ratio = sampleRate / 16000;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const position = i * ratio;
    const low = Math.floor(position);
    const high = Math.min(low + 1, samples.length - 1);
    const t = position - low;
    out[i] = (samples[low] as number) * (1 - t) + (samples[high] as number) * t;
  }
  return out;
}

async function embed(samples: Float32Array, sampleRate: number): Promise<Float32Array | null> {
  if (!session) return null;
  const audio = to16k(samples, sampleRate);
  const fbank = kaldiFbank(audio);
  if (!fbank) return null;

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) return null;

  const tensor = new ort.Tensor('float32', fbank.features, [1, fbank.frames, FBANK_BINS]);
  const outputs = await session.run({ [inputName]: tensor });
  const output = outputs[outputName];
  if (!output) return null;
  return Float32Array.from(output.data as Float32Array);
}

self.onmessage = (event: MessageEvent<Request>): void => {
  const message = event.data;

  if (message.type === 'load') {
    loading ??= load(message.modelUrl)
      // The runtime tag deliberately versions the emitted worker asset. The
      // previous content-hashed URL may be preserved by an installed service
      // worker together with its pre-isolation response headers; a new URL
      // guarantees the browser fetches the corrected isolated response.
      .then(() => post({ type: 'ready', runtime: 'coep-v1' }))
      .catch((error: unknown) => {
        loading = null;
        post({ type: 'load-error', message: error instanceof Error ? error.message : String(error) });
      });
    return;
  }

  if (message.type === 'embed') {
    void embed(message.samples, message.sampleRate)
      .then((embedding) => {
        post(
          { type: 'embedding', id: message.id, embedding },
          embedding ? [embedding.buffer] : [],
        );
      })
      .catch(() => post({ type: 'embedding', id: message.id, embedding: null }));
  }
};
