/**
 * Main-thread client for the speaker-embedding worker.
 *
 * Deliberately fail-soft everywhere: before the model has loaded, while it is
 * loading, after a load failure, or on a slow inference, `embed` resolves to
 * null and the caller falls back to the pitch-and-timbre heuristics. The
 * device must work identically on its first ever launch (model still
 * downloading) and fully offline (model already in the cache).
 */

import SpeakerEmbedderWorker from './speakerEmbedder.worker.ts?worker';

interface Pending {
  resolve: (embedding: Float32Array | null) => void;
  timer: number;
}

const EMBED_TIMEOUT_MS = 5000;

export type EmbedderState = 'loading' | 'ready' | 'error';

export class SpeakerEmbedder {
  #worker: Worker | null = null;
  #ready = false;
  #failed: string | null = null;
  #pending = new Map<number, Pending>();
  #nextId = 1;
  #onState: ((state: EmbedderState, detail: string) => void) | null = null;

  /** One listener, for surfacing the model's state in diagnostics. */
  onState(listener: (state: EmbedderState, detail: string) => void): void {
    this.#onState = listener;
  }

  #announce(state: EmbedderState, detail: string): void {
    this.#onState?.(state, detail);
  }

  /** Idempotent: the first call starts the worker and the model download. */
  start(modelUrl: string): void {
    if (this.#worker || this.#failed !== null) return;
    try {
      // The Vite worker constructor keeps Vinext's server-side source URL out
      // of the browser bundle. `new URL(..., import.meta.url)` is normally
      // equivalent, but Vinext rewrites that base to a `file:///ROOT/...`
      // placeholder, which browsers correctly reject on an HTTPS origin.
      this.#worker = new SpeakerEmbedderWorker();
    } catch (error) {
      this.#failed = error instanceof Error ? error.message : String(error);
      this.#announce('error', this.#failed);
      return;
    }
    this.#announce('loading', 'Downloading and compiling the voiceprint network…');

    this.#worker.onmessage = (
      event: MessageEvent<
        | { type: 'ready' }
        | { type: 'load-error'; message: string }
        | { type: 'embedding'; id: number; embedding: Float32Array | null }
      >,
    ) => {
      const message = event.data;
      if (message.type === 'ready') {
        this.#ready = true;
        this.#announce('ready', 'Voiceprint network loaded; attribution is neural.');
        return;
      }
      if (message.type === 'load-error') {
        this.#failed = message.message;
        this.#ready = false;
        this.#announce('error', message.message);
        return;
      }
      const pending = this.#pending.get(message.id);
      if (pending) {
        this.#pending.delete(message.id);
        window.clearTimeout(pending.timer);
        pending.resolve(message.embedding);
      }
    };
    this.#worker.onerror = (event) => {
      this.#failed = `The speaker-embedding worker crashed${event.message ? `: ${event.message}` : '.'}`;
      this.#ready = false;
      this.#announce('error', this.#failed);
    };

    this.#worker.postMessage({ type: 'load', modelUrl });
  }

  get ready(): boolean {
    return this.#ready;
  }

  /** Why the neural path is unavailable, for diagnostics. Null while fine. */
  get failure(): string | null {
    return this.#failed;
  }

  /**
   * Compute a voiceprint for one utterance. Resolves null rather than ever
   * throwing or hanging: attribution must not wait on a model.
   */
  embed(samples: Float32Array, sampleRate: number): Promise<Float32Array | null> {
    if (!this.#worker || !this.#ready || samples.length === 0) return Promise.resolve(null);

    const id = this.#nextId;
    this.#nextId += 1;

    return new Promise<Float32Array | null>((resolve) => {
      const timer = window.setTimeout(() => {
        this.#pending.delete(id);
        resolve(null);
      }, EMBED_TIMEOUT_MS);
      this.#pending.set(id, { resolve, timer });
      // A copy is transferred so the caller's buffer stays usable.
      const copy = Float32Array.from(samples);
      this.#worker?.postMessage({ type: 'embed', id, samples: copy, sampleRate }, [copy.buffer]);
    });
  }

  dispose(): void {
    this.#worker?.terminate();
    this.#worker = null;
    this.#ready = false;
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timer);
      pending.resolve(null);
    }
    this.#pending.clear();
  }
}

export const speakerEmbedder = new SpeakerEmbedder();
