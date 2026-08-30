/**
 * Adaptive-energy voice activity detection.
 *
 * The specification prefers Silero VAD via the Sherpa bundle; this is the
 * always-available fallback, and it is what gates the recogniser when no VAD
 * model is installed. Either way the contract is the same: the Zipformer never
 * sees silence, which is most of any real conversation.
 *
 * The noise floor adapts asymmetrically - quickly downward, slowly upward - so
 * a quiet room is tracked promptly while speech itself cannot drag the floor up
 * and deafen the detector mid-sentence.
 */

export interface VadOptions {
  /** How far above the noise floor a frame must sit to count as speech. */
  activationDb: number;
  /** Hysteresis: release threshold sits this far below the activation one. */
  releaseDb: number;
  /** Consecutive speech frames required before declaring speech. */
  minSpeechFrames: number;
  /** Silent frames tolerated inside an utterance before it is closed. */
  hangoverFrames: number;
  /** Absolute floor guarding against a pathologically silent input device. */
  noiseFloorFloorDb: number;
}

export const DEFAULT_VAD_OPTIONS: VadOptions = {
  activationDb: 9,
  releaseDb: 5,
  minSpeechFrames: 2,
  hangoverFrames: 12, // ~0.75 s at 1024 samples / 16 kHz
  noiseFloorFloorDb: -75,
};

export type VadTransition = 'speech-start' | 'speech-end' | null;

const SILENCE_DB = -100;

export function amplitudeToDb(amplitude: number): number {
  if (amplitude <= 1e-10) return SILENCE_DB;
  return 20 * Math.log10(amplitude);
}

export class EnergyVad {
  #options: VadOptions;
  #noiseFloorDb: number;
  #speechFrames = 0;
  #silenceFrames = 0;
  #active = false;
  #calibrationFrames = 0;

  constructor(options: Partial<VadOptions> = {}) {
    this.#options = { ...DEFAULT_VAD_OPTIONS, ...options };
    this.#noiseFloorDb = this.#options.noiseFloorFloorDb;
  }

  get active(): boolean {
    return this.#active;
  }

  get noiseFloorDb(): number {
    return this.#noiseFloorDb;
  }

  configure(options: Partial<VadOptions>): void {
    this.#options = { ...this.#options, ...options };
  }

  /**
   * @param rms Root-mean-square amplitude of one analysis frame.
   * @returns the transition this frame caused, or null.
   */
  process(rms: number): VadTransition {
    const levelDb = amplitudeToDb(rms);

    // First ~0.5 s is treated as room tone so the floor starts somewhere sane.
    if (this.#calibrationFrames < 8) {
      this.#calibrationFrames += 1;
      this.#noiseFloorDb = Math.max(
        this.#options.noiseFloorFloorDb,
        this.#calibrationFrames === 1 ? levelDb : Math.min(this.#noiseFloorDb, levelDb),
      );
      return null;
    }

    const threshold = this.#noiseFloorDb + (this.#active ? this.#options.releaseDb : this.#options.activationDb);
    const isSpeech = levelDb > threshold;

    if (!isSpeech) {
      // Downward adaptation is fast; the room got quieter and we should notice.
      this.#noiseFloorDb =
        levelDb < this.#noiseFloorDb
          ? Math.max(this.#options.noiseFloorFloorDb, this.#noiseFloorDb * 0.9 + levelDb * 0.1)
          : Math.max(this.#options.noiseFloorFloorDb, this.#noiseFloorDb * 0.995 + levelDb * 0.005);
    }

    if (isSpeech) {
      this.#silenceFrames = 0;
      this.#speechFrames += 1;
      if (!this.#active && this.#speechFrames >= this.#options.minSpeechFrames) {
        this.#active = true;
        return 'speech-start';
      }
      return null;
    }

    this.#speechFrames = 0;
    if (!this.#active) return null;

    this.#silenceFrames += 1;
    if (this.#silenceFrames >= this.#options.hangoverFrames) {
      this.#active = false;
      this.#silenceFrames = 0;
      return 'speech-end';
    }
    return null;
  }

  reset(): void {
    this.#speechFrames = 0;
    this.#silenceFrames = 0;
    this.#active = false;
    this.#calibrationFrames = 0;
    this.#noiseFloorDb = this.#options.noiseFloorFloorDb;
  }
}
