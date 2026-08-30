import type { AudioFrame, CaptureChannel } from '@/audio/AudioGraph';
import { Emitter } from '@/lib/events';
import { createIsolatedWorker } from '@/lib/isolatedWorker';
import { isModuleBundle } from '../bundleShape';
import { wordConfidences } from '../confidence';
import { EnergyVad, type VadOptions } from '../vad';
import type { AsrEvents, AsrProvider, EngineInfo } from '../types';

// Version the URL so an older service-worker cache cannot return the script
// without the cross-origin isolation headers required by the current page.
const WORKER_URL = '/workers/sherpa-asr-worker.js?coep=v1';

/**
 * Frames retained before speech is confirmed.
 *
 * The VAD needs a couple of frames of evidence before it will commit, and
 * without a pre-roll those frames are thrown away - which reliably decapitates
 * the first consonant of every utterance. Three frames at 1024/16 kHz is ~190 ms,
 * comfortably more than the detector's own latency.
 */
const PREROLL_FRAMES = 3;

/** Filenames used by the stock release bundles. */
const DEFAULT_ENTRIES = { helper: 'sherpa-onnx-asr.js', glue: 'sherpa-onnx-wasm-main-asr.js', factory: 'createOnlineRecognizer' };

export interface SherpaAsrOptions {
  readonly base: string;
  readonly mode?: 'streaming' | 'offline';
  readonly vad?: Partial<VadOptions>;
  /** Optional overrides when a bundle uses non-default filenames. */
  readonly entries?: { helper?: string; glue?: string; factory?: string };
  readonly config?: unknown;
}

interface ChannelState {
  vad: EnergyVad;
  preroll: Float32Array[];
  speaking: boolean;
}

type WorkerMessage =
  | { type: 'status'; status: EngineInfo['status']; detail?: string; heapBytes?: number; streaming?: boolean }
  | {
      type: 'result';
      channel: CaptureChannel;
      text: string;
      final: boolean;
      timestamp: number;
      tokens?: string[] | null;
      tokenLogProbs?: number[] | null;
    }
  | { type: 'heap'; bytes: number }
  | { type: 'progress'; text: string }
  | { type: 'log'; level: string; text: string }
  | { type: 'disposed' };

/**
 * Streaming recognition on the Sherpa-ONNX WebAssembly runtime.
 *
 * The provider owns the VAD gate: frames are only forwarded to the neural
 * network while somebody is actually talking. On a laptop that is the
 * difference between a warm palm rest and a cold one; on a phone it is the
 * difference between a full day of battery and half of one.
 */
export class SherpaOnnxAsrProvider implements AsrProvider {
  readonly events = new Emitter<AsrEvents>();

  #worker: Worker | null = null;
  #options: SherpaAsrOptions;
  #channels = new Map<CaptureChannel, ChannelState>();
  #info: EngineInfo = {
    status: 'idle',
    implementation: 'sherpa-onnx',
    offline: true,
    streaming: true,
  };
  #heapPoll: ReturnType<typeof setInterval> | null = null;

  constructor(options: SherpaAsrOptions) {
    this.#options = options;
  }

  get info(): EngineInfo {
    return this.#info;
  }

  async init(): Promise<void> {
    if (this.#worker) return;

    this.#setInfo({ status: 'loading', detail: 'Starting recognition worker…' });

    // A worker's type is fixed at construction, so the bundle shape has to be
    // known first. See bundleShape.ts.
    const entries = { ...DEFAULT_ENTRIES, ...this.#options.entries };
    const moduleBundle = await isModuleBundle(this.#options.base, entries.glue);

    const worker = createIsolatedWorker(WORKER_URL, moduleBundle ? 'module' : 'classic');
    this.#worker = worker;

    const readyPromise = new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type !== 'status') return;
        if (message.status === 'ready') {
          worker.removeEventListener('message', onMessage);
          resolve();
        } else if (message.status === 'error') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(message.detail ?? 'Recognition worker failed to initialise.'));
        }
      };
      worker.addEventListener('message', onMessage);
    });

    worker.addEventListener('message', this.#onMessage);
    worker.addEventListener('error', this.#onWorkerError);

    worker.postMessage({
      type: 'init',
      base: this.#options.base,
      mode: this.#options.mode ?? 'streaming',
      entries,
      moduleBundle,
      config: this.#options.config,
      vad: this.#options.vad,
    });

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

    // Heap growth is the tell for a leaked C++ handle. Surfacing it in the UI
    // beats asking an engineer to remember to take heap snapshots.
    this.#heapPoll = setInterval(() => this.#worker?.postMessage({ type: 'heap' }), 5000);
  }

  acceptFrame(frame: AudioFrame): void {
    if (this.#info.status !== 'ready' || !this.#worker) return;

    const state = this.#channelState(frame.channel);
    const transition = state.vad.process(frame.rms);

    if (transition === 'speech-start') {
      state.speaking = true;
      for (const buffered of state.preroll) {
        this.#send(frame.channel, buffered);
      }
      state.preroll = [];
    }

    if (state.speaking) {
      this.#send(frame.channel, frame.samples);
    } else {
      state.preroll.push(frame.samples);
      if (state.preroll.length > PREROLL_FRAMES) state.preroll.shift();
    }

    if (transition === 'speech-end') {
      state.speaking = false;
      state.preroll = [];
      this.flush(frame.channel);
    }
  }

  createAudioInputPort(channel: CaptureChannel): MessagePort | null {
    if (this.#info.status !== 'ready' || !this.#worker || typeof MessageChannel === 'undefined') {
      return null;
    }
    const link = new MessageChannel();
    this.#worker.postMessage(
      { type: 'bind-audio-port', channel, port: link.port1 },
      [link.port1],
    );
    return link.port2;
  }

  flush(channel: CaptureChannel): void {
    this.#worker?.postMessage({ type: 'flush', channel });
  }

  reset(channel: CaptureChannel): void {
    this.#channelState(channel).vad.reset();
    this.#worker?.postMessage({ type: 'reset', channel });
  }

  configureVad(options: Partial<VadOptions>): void {
    this.#options = { ...this.#options, vad: { ...this.#options.vad, ...options } };
    for (const state of this.#channels.values()) state.vad.configure(options);
    this.#worker?.postMessage({ type: 'configure-vad', options });
  }

  async dispose(): Promise<void> {
    if (this.#heapPoll) {
      clearInterval(this.#heapPoll);
      this.#heapPoll = null;
    }
    const worker = this.#worker;
    this.#worker = null;
    if (!worker) return;

    worker.removeEventListener('message', this.#onMessage);
    worker.removeEventListener('error', this.#onWorkerError);
    // Give the worker a beat to free its C++ objects, then take the thread back.
    worker.postMessage({ type: 'dispose' });
    setTimeout(() => worker.terminate(), 250);

    this.#channels.clear();
    this.#setInfo({ status: 'idle', detail: undefined, heapBytes: undefined });
  }

  // -------------------------------------------------------------------------

  #send(channel: CaptureChannel, samples: Float32Array): void {
    // Copy before transferring: the caller may still hold a reference, and a
    // detached ArrayBuffer surfaces as a baffling zero-length read later.
    const copy = samples.slice();
    this.#worker?.postMessage({ type: 'frame', channel, samples: copy }, [copy.buffer]);
  }

  #channelState(channel: CaptureChannel): ChannelState {
    let state = this.#channels.get(channel);
    if (!state) {
      state = { vad: new EnergyVad(this.#options.vad), preroll: [], speaking: false };
      this.#channels.set(channel, state);
    }
    return state;
  }

  #onMessage = (event: MessageEvent<WorkerMessage>): void => {
    const message = event.data;
    switch (message.type) {
      case 'status':
        this.#setInfo({
          status: message.status,
          detail: message.detail,
          heapBytes: message.heapBytes,
          streaming: message.streaming ?? this.#info.streaming,
        });
        if (message.status === 'error') {
          this.events.emit('error', new Error(message.detail ?? 'Recognition failed.'));
        }
        break;

      case 'result':
        this.events.emit('result', {
          channel: message.channel,
          text: message.text,
          final: message.final,
          timestamp: message.timestamp,
          // Folded here rather than in the worker so one implementation is
          // shared with the tests; null whenever the model reports nothing.
          words: wordConfidences(message.tokens, message.tokenLogProbs),
        });
        break;

      case 'heap':
        this.#setInfo({ heapBytes: message.bytes });
        break;

      case 'progress':
        this.#setInfo({ detail: message.text });
        break;

      case 'log':
        // Sherpa runs with debug enabled and writes its diagnostics to stderr,
        // which the worker forwards here. Dropping them silently means a
        // failure inside the WebAssembly runtime surfaces as a bare
        // "generation failed" with the actual cause discarded.
        if (message.level === 'error') console.warn(`[aac:recognition]`, message.text);
        else console.debug(`[aac:recognition]`, message.text);
        break;

      default:
        break;
    }
  };

  #onWorkerError = (event: ErrorEvent): void => {
    this.#setInfo({ status: 'error', detail: event.message });
    this.events.emit('error', new Error(event.message));
  };

  #setInfo(patch: Partial<EngineInfo>): void {
    this.#info = { ...this.#info, ...patch };
    this.events.emit('info', this.#info);
  }
}
