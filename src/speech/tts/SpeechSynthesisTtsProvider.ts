import { Emitter } from '@/lib/events';
import type { EngineInfo, SynthesisRequest, SynthesisResult, TtsEvents, TtsProvider, TtsVoice } from '../types';

export function isSpeechSynthesisAvailable(): boolean {
  return typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis;
}

/**
 * Platform synthesis via `speechSynthesis`.
 *
 * The important limitation, stated once here and surfaced throughout the UI:
 * this API renders to the operating system's mixer, not into any Web Audio
 * graph we can reach. There is no buffer to capture and therefore no way to put
 * this voice on a WebRTC track. It works perfectly for in-person, face-to-face
 * AAC use, and not at all for remote calls - where the peer will still receive
 * the text over the data channel, but will hear nothing.
 *
 * On macOS, Windows and most Android builds the voices are on-device, so this
 * path remains BIPA-safe: no audio is uploaded. It is the recogniser, not the
 * synthesiser, that carries the biometric risk.
 */
export class SpeechSynthesisTtsProvider implements TtsProvider {
  readonly events = new Emitter<TtsEvents>();
  readonly routable = false;

  #voices: TtsVoice[] = [];
  #info: EngineInfo = {
    status: 'idle',
    implementation: 'web-speech',
    offline: true,
    detail: 'Platform voice - audible locally, cannot be sent to a remote peer.',
  };

  get info(): EngineInfo {
    return this.#info;
  }

  async init(): Promise<void> {
    if (!isSpeechSynthesisAvailable()) {
      this.#setInfo({ status: 'unavailable', detail: 'This browser has no speechSynthesis API.' });
      throw new Error('speechSynthesis is not available in this browser.');
    }

    await this.#loadVoices();
    this.#setInfo({
      status: 'ready',
      detail: 'Platform voice - audible locally, cannot be sent to a remote peer.',
      modelName: this.#voices[0]?.name,
    });
  }

  voices(): TtsVoice[] {
    return this.#voices;
  }

  /**
   * Unsupported by construction - there is no PCM to return. Callers must check
   * `routable` and use `speakDirect` instead.
   */
  synthesize(_request: SynthesisRequest): Promise<SynthesisResult> {
    void _request;
    return Promise.reject(
      new Error(
        'The platform voice cannot produce an audio buffer. It can be played locally with speakDirect(), but it cannot be routed to a peer.',
      ),
    );
  }

  speakDirect(request: SynthesisRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      const text = request.text.trim();
      if (text.length === 0) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = globalThis.speechSynthesis
        .getVoices()
        .find((candidate) => candidate.voiceURI === request.voiceId);
      if (voice) utterance.voice = voice;
      utterance.rate = request.rate ?? 1;

      utterance.onend = () => resolve();
      utterance.onerror = (event) => {
        // A cancel() mid-utterance fires an error; that is expected, not a fault.
        if (event.error === 'canceled' || event.error === 'interrupted') resolve();
        else reject(new Error(`Speech synthesis failed: ${event.error}`));
      };

      globalThis.speechSynthesis.speak(utterance);
    });
  }

  cancel(): void {
    if (isSpeechSynthesisAvailable()) globalThis.speechSynthesis.cancel();
  }

  async dispose(): Promise<void> {
    this.cancel();
    this.#setInfo({ status: 'idle' });
  }

  /** Voice lists populate asynchronously in Chrome; wait for the first batch. */
  #loadVoices(): Promise<void> {
    return new Promise((resolve) => {
      const collect = (): boolean => {
        const voices = globalThis.speechSynthesis.getVoices();
        if (voices.length === 0) return false;
        this.#voices = voices.map((voice) => ({
          id: voice.voiceURI,
          name: `${voice.name}${voice.localService ? '' : ' (network)'}`,
          language: voice.lang,
        }));
        return true;
      };

      if (collect()) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        collect();
        resolve();
      }, 2000);

      globalThis.speechSynthesis.addEventListener(
        'voiceschanged',
        () => {
          clearTimeout(timeout);
          collect();
          resolve();
        },
        { once: true },
      );
    });
  }

  #setInfo(patch: Partial<EngineInfo>): void {
    this.#info = { ...this.#info, ...patch };
    this.events.emit('info', this.#info);
  }
}
