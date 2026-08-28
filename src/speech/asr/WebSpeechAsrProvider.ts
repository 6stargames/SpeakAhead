import type { AudioFrame, CaptureChannel } from '@/audio/AudioGraph';
import { Emitter } from '@/lib/events';
import type { AsrEvents, AsrProvider, EngineInfo } from '../types';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    item(index: number): SpeechRecognitionResultLike;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionConstructor | null {
  const scope = globalThis as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function isWebSpeechRecognitionAvailable(): boolean {
  return getConstructor() !== null;
}

/**
 * Platform speech recognition, offered only as an explicitly consented fallback.
 *
 * This is **not** a BIPA-safe path. Chrome's implementation streams microphone
 * audio to a Google service for transcription, which is precisely the data flow
 * the edge architecture exists to avoid. It is included because a user with no
 * model weights installed and no other way to communicate is worse off than a
 * user who has been told the trade-off and chosen it — but it must never be
 * selected silently, and `offline` is reported as `false` so the interface can
 * say so plainly.
 *
 * It also only ever hears the physical microphone, so it cannot transcribe the
 * remote peer and cannot supply the agent with conversational context.
 */
export class WebSpeechAsrProvider implements AsrProvider {
  readonly events = new Emitter<AsrEvents>();

  #recognition: SpeechRecognitionLike | null = null;
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  #shouldRun = false;
  #language: string;
  #info: EngineInfo = {
    status: 'idle',
    implementation: 'web-speech',
    offline: false,
    streaming: true,
    detail: 'Cloud transcription — not BIPA-compliant.',
  };

  constructor(options: { language?: string } = {}) {
    this.#language = options.language ?? 'en-US';
  }

  get info(): EngineInfo {
    return this.#info;
  }

  async init(): Promise<void> {
    const Constructor = getConstructor();
    if (!Constructor) {
      this.#setInfo({ status: 'unavailable', detail: 'This browser has no SpeechRecognition API.' });
      throw new Error('SpeechRecognition is not available in this browser.');
    }

    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = this.#language;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const alternative = result[0];
        if (!alternative) continue;
        this.events.emit('result', {
          channel: 'local',
          text: alternative.transcript.trim(),
          final: result.isFinal,
          timestamp: Date.now(),
        });
      }
    };

    recognition.onerror = (event) => {
      const code = event.error ?? 'unknown';
      // `no-speech` and `aborted` are routine; only surface real failures.
      if (code === 'no-speech' || code === 'aborted') return;
      this.#setInfo({ status: 'error', detail: `SpeechRecognition error: ${code}` });
      this.events.emit('error', new Error(`SpeechRecognition error: ${code}`));
    };

    // Chrome ends the session periodically; restart to keep it continuous.
    recognition.onend = () => {
      if (!this.#shouldRun) return;
      this.#restartTimer = setTimeout(() => {
        try {
          recognition.start();
        } catch {
          /* Already starting. */
        }
      }, 250);
    };

    this.#recognition = recognition;
    this.#shouldRun = true;
    recognition.start();
    this.#setInfo({ status: 'ready', detail: 'Cloud transcription — not BIPA-compliant.' });
  }

  /**
   * No-op by design. This engine taps the microphone itself; it cannot be fed
   * from the Web Audio graph, which also means it cannot see the remote peer.
   */
  acceptFrame(_frame: AudioFrame): void {
    void _frame;
  }

  flush(_channel: CaptureChannel): void {
    void _channel;
  }

  reset(_channel: CaptureChannel): void {
    void _channel;
  }

  async dispose(): Promise<void> {
    this.#shouldRun = false;
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
    try {
      this.#recognition?.abort();
    } catch {
      /* Nothing running. */
    }
    this.#recognition = null;
    this.#setInfo({ status: 'idle' });
  }

  #setInfo(patch: Partial<EngineInfo>): void {
    this.#info = { ...this.#info, ...patch };
    this.events.emit('info', this.#info);
  }
}
