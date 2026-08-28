import { Emitter } from '@/lib/events';
import { createId } from '@/lib/id';
import { deriveVitsConfig, inspectBundle } from '../bundleShape';
import type { EngineInfo, SynthesisRequest, SynthesisResult, TtsEvents, TtsProvider, TtsVoice } from '../types';

const WORKER_URL = '/workers/sherpa-tts-worker.js';

/**
 * Newer bundles ship their own module worker, and it is the supported way in.
 *
 * Its header explains why, and it matches what happens if you ignore it: the
 * glue is built with -sEXPORT_ES6=1 so its pthread runtime can spawn a worker
 * pool from inside the worker, and loading the same glue any other way hangs
 * during nested pthread bootstrap — silently, with no error and no output.
 *
 * So when the bundle provides a worker, use it and translate its protocol.
 * Older classic bundles ship no worker, and those still use ours.
 */
const BUNDLED_WORKER = 'sherpa-onnx-tts.worker.js';

async function hasBundledWorker(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/${BUNDLED_WORKER}`, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}
const SYNTHESIS_TIMEOUT_MS = 30_000;

/** Filenames used by the stock release bundles. */
const DEFAULT_ENTRIES = { helper: 'sherpa-onnx-tts.js', glue: 'sherpa-onnx-wasm-main-tts.js', factory: 'createOfflineTts' };

export interface SherpaTtsOptions {
  readonly base: string;
  readonly voices?: TtsVoice[];
  readonly entries?: { helper?: string; glue?: string; factory?: string };
  readonly config?: unknown;
}

type WorkerMessage =
  | { type: 'status'; status: EngineInfo['status']; detail?: string; heapBytes?: number; sampleRate?: number; numSpeakers?: number; requestId?: string }
  | { type: 'audio'; requestId: string; samples: Float32Array; sampleRate: number; elapsedMs: number }
  | { type: 'cancelled'; requestId: string }
  | { type: 'heap'; bytes: number }
  | { type: 'progress'; text: string }
  | { type: 'log'; level: string; text: string }
  | { type: 'disposed' }
  // The bundle's own protocol.
  | { type: 'sherpa-onnx-tts-ready'; modelType: string; numSpeakers: number }
  | { type: 'sherpa-onnx-tts-progress'; status: string }
  | { type: 'sherpa-onnx-tts-generation-progress'; progress: number }
  | { type: 'sherpa-onnx-tts-result'; samples: Float32Array; sampleRate: number }
  | { type: 'error'; message: string };

interface PendingRequest {
  resolve: (result: SynthesisResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Offline neural synthesis (Piper / VITS / Kokoro) on the Sherpa-ONNX runtime.
 *
 * Produces PCM rather than playing it. Keeping synthesis and playback separate
 * is what lets the same buffer feed the speakers and the peer connection from a
 * single node, which is the whole basis of the RAUR routing guarantee.
 */
export class SherpaOnnxTtsProvider implements TtsProvider {
  readonly events = new Emitter<TtsEvents>();
  readonly routable = true;

  #worker: Worker | null = null;
  #options: SherpaTtsOptions;
  #pending = new Map<string, PendingRequest>();
  #voices: TtsVoice[];
  #numSpeakers = 1;
  /** True when driving the bundle's own worker rather than ours. */
  #bundled = false;
  /** The bundle's protocol has no request ids; only one job runs at a time. */
  #currentRequestId: string | null = null;
  #info: EngineInfo = {
    status: 'idle',
    implementation: 'sherpa-onnx',
    offline: true,
  };

  constructor(options: SherpaTtsOptions) {
    this.#options = options;
    this.#voices = options.voices ?? [];
  }

  get info(): EngineInfo {
    return this.#info;
  }

  async init(): Promise<void> {
    if (this.#worker) return;
    this.#setInfo({ status: 'loading', detail: 'Loading synthesis voice…' });

    const entries = { ...DEFAULT_ENTRIES, ...this.#options.entries };

    // A worker's type is fixed at construction, so the shape has to be known
    // first — and the packaged file list tells us whether the helper's default
    // model path actually exists. See bundleShape.ts.
    const bundle = await inspectBundle(this.#options.base, entries.glue);
    const moduleBundle = bundle.moduleBundle;
    const config = this.#options.config ?? deriveVitsConfig(bundle.files);

    // Only module bundles need their own worker — those are the ones whose glue
    // cannot be loaded any other way. Classic bundles also ship a worker, but
    // it is a *classic* worker, so spawning it as a module would break it, and
    // ours gives cancellation, teardown and heap reporting that theirs lacks.
    this.#bundled = moduleBundle && (await hasBundledWorker(this.#options.base));

    const worker = this.#bundled
      ? new Worker(`${this.#options.base}/${BUNDLED_WORKER}`, { type: 'module' })
      : new Worker(WORKER_URL, { type: moduleBundle ? 'module' : 'classic' });
    this.#worker = worker;

    const readyPromise = new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;

        if (message.type === 'sherpa-onnx-tts-ready') {
          this.#numSpeakers = message.numSpeakers ?? 1;
          worker.removeEventListener('message', onMessage);
          resolve();
          return;
        }
        if (message.type === 'error') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(message.message));
          return;
        }
        if (message.type !== 'status') return;

        if (message.status === 'ready') {
          this.#numSpeakers = message.numSpeakers ?? 1;
          worker.removeEventListener('message', onMessage);
          resolve();
        } else if (message.status === 'error') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(message.detail ?? 'Synthesis worker failed to initialise.'));
        }
      };
      worker.addEventListener('message', onMessage);
    });

    worker.addEventListener('message', this.#onMessage);
    worker.addEventListener('error', this.#onWorkerError);

    // The bundle's worker begins initialising the moment it loads and takes no
    // init message; ours needs to be told where the model lives.
    if (!this.#bundled) {
      worker.postMessage({
        type: 'init',
        base: this.#options.base,
        entries,
        moduleBundle,
        config,
      });
    }

    try {
      await readyPromise;
    } catch (error) {
      this.#setInfo({
        status: 'unavailable',
        detail: error instanceof Error ? error.message : String(error),
      });
      await this.dispose();
      throw error;
    }

    if (this.#voices.length === 0) {
      this.#voices = Array.from({ length: this.#numSpeakers }, (_, index) => ({
        id: String(index),
        name: this.#numSpeakers === 1 ? 'Default voice' : `Voice ${index + 1}`,
        language: 'en-US',
        speakerId: index,
      }));
    }
  }

  voices(): TtsVoice[] {
    return this.#voices;
  }

  synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const worker = this.#worker;
    if (!worker || this.#info.status !== 'ready') {
      return Promise.reject(new Error('Synthesis engine is not ready.'));
    }

    const text = request.text.trim();
    if (text.length === 0) {
      return Promise.resolve({ samples: new Float32Array(0), sampleRate: 22050, durationMs: 0 });
    }

    const requestId = createId('tts');
    const speakerId = this.#voices.find((voice) => voice.id === request.voiceId)?.speakerId ?? 0;

    return new Promise<SynthesisResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error('Synthesis timed out. The voice model may be too large for this device.'));
      }, SYNTHESIS_TIMEOUT_MS);

      this.#pending.set(requestId, { resolve, reject, timer });

      if (this.#bundled) {
        this.#currentRequestId = requestId;
        worker.postMessage({ type: 'generate', text, sid: speakerId, speed: request.rate ?? 1 });
      } else {
        worker.postMessage({ type: 'synthesize', requestId, text, speakerId, rate: request.rate ?? 1 });
      }
    });
  }

  cancel(): void {
    this.#currentRequestId = null;
    // The bundle's worker has no cancel message; synthesis there runs to
    // completion and the result is simply discarded.
    if (!this.#bundled) this.#worker?.postMessage({ type: 'cancel' });
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Synthesis cancelled.'));
      this.#pending.delete(id);
    }
  }

  async dispose(): Promise<void> {
    this.cancel();
    const worker = this.#worker;
    this.#worker = null;
    if (!worker) return;

    worker.removeEventListener('message', this.#onMessage);
    worker.removeEventListener('error', this.#onWorkerError);
    // The bundle's worker exposes no teardown, so terminating is the only lever.
    if (this.#bundled) worker.terminate();
    else {
      worker.postMessage({ type: 'dispose' });
      setTimeout(() => worker.terminate(), 250);
    }
    this.#setInfo({ status: 'idle' });
  }

  // -------------------------------------------------------------------------

  #onMessage = (event: MessageEvent<WorkerMessage>): void => {
    const message = event.data;
    switch (message.type) {
      case 'status': {
        this.#setInfo({
          status: message.status,
          detail: message.detail,
          heapBytes: message.heapBytes,
        });
        if (message.status === 'error') {
          const error = new Error(message.detail ?? 'Synthesis failed.');
          if (message.requestId) this.#settle(message.requestId, error);
          else this.events.emit('error', error);
        }
        break;
      }

      case 'audio': {
        const pending = this.#pending.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(message.requestId);
        pending.resolve({
          samples: message.samples,
          sampleRate: message.sampleRate,
          durationMs: (message.samples.length / message.sampleRate) * 1000,
        });
        break;
      }

      // --- the bundle's own protocol ---------------------------------------

      case 'sherpa-onnx-tts-result': {
        const requestId = this.#currentRequestId;
        this.#currentRequestId = null;
        const pending = requestId ? this.#pending.get(requestId) : undefined;
        if (!pending || !requestId) return;
        clearTimeout(pending.timer);
        this.#pending.delete(requestId);
        pending.resolve({
          samples: message.samples,
          sampleRate: message.sampleRate,
          durationMs: (message.samples.length / message.sampleRate) * 1000,
        });
        break;
      }

      case 'sherpa-onnx-tts-progress':
        this.#setInfo({ detail: message.status });
        break;

      case 'error': {
        const error = new Error(message.message);
        const requestId = this.#currentRequestId;
        this.#currentRequestId = null;
        if (requestId) this.#settle(requestId, error);
        else {
          this.#setInfo({ status: 'error', detail: message.message });
          this.events.emit('error', error);
        }
        break;
      }

      case 'cancelled':
        this.#settle(message.requestId, new Error('Synthesis cancelled.'));
        break;

      case 'heap':
        this.#setInfo({ heapBytes: message.bytes });
        break;

      case 'sherpa-onnx-tts-generation-progress':
        this.#setInfo({ detail: `Generating ${Math.round(message.progress * 100)}%` });
        break;

      case 'progress':
        this.#setInfo({ detail: message.text });
        break;

      case 'log':
        // Sherpa runs with debug enabled and writes its diagnostics to stderr,
        // which the worker forwards here. Dropping them silently means a
        // failure inside the WebAssembly runtime surfaces as a bare
        // "generation failed" with the actual cause discarded.
        if (message.level === 'error') console.warn(`[aac:synthesis]`, message.text);
        else console.debug(`[aac:synthesis]`, message.text);
        break;

      default:
        break;
    }
  };

  #settle(requestId: string, error: Error): void {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(requestId);
    pending.reject(error);
  }

  #onWorkerError = (event: ErrorEvent): void => {
    this.#setInfo({ status: 'error', detail: event.message });
    this.events.emit('error', new Error(event.message));
  };

  #setInfo(patch: Partial<EngineInfo>): void {
    this.#info = { ...this.#info, ...patch };
    this.events.emit('info', this.#info);
  }
}
