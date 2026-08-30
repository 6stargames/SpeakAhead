import { centsBetween, median } from './pitch';

/**
 * Detect the voice changing part-way through an utterance.
 *
 * The recogniser ends a turn when it hears silence. People do not wait for
 * silence - one person stops, another starts, and with no pause between them
 * the recogniser produces a single utterance containing two speakers. It lands
 * in one bubble attributed to whoever's pitch happened to dominate.
 *
 * So the pitch track is watched for a sustained move away from where the
 * utterance started. Sustained is the important word: a single frame jumping is
 * an octave error or a stray harmonic, and splitting on those would chop one
 * person into fragments - a worse failure than merging two people, because the
 * transcript would stop being readable at all.
 */

/**
 * How far the voice must move to count as somebody else.
 *
 * Five semitones. Deliberately wider than the tolerance used to match a voice
 * to a profile: one person's intonation swings a great deal across a sentence,
 * especially asking a question, and a false split is more damaging here than a
 * missed one.
 */
const CHANGE_THRESHOLD_CENTS = 500;

/** Voiced frames that must agree before a change is declared (~320 ms). */
const CONFIRM_FRAMES = 5;

/** Frames needed to establish what the current voice sounds like. */
const REFERENCE_FRAMES = 6;

export class SpeakerChangeDetector {
  #reference: number[] = [];
  #referencePitch: number | null = null;
  #window: number[] = [];

  /**
   * Feed one voiced pitch estimate.
   *
   * @returns true when the voice appears to have changed. The caller should
   *   close the current utterance and begin a new one.
   */
  push(pitch: number): boolean {
    // Still learning what this voice sounds like.
    if (this.#referencePitch === null) {
      this.#reference.push(pitch);
      if (this.#reference.length >= REFERENCE_FRAMES) {
        this.#referencePitch = median(this.#reference);
      }
      return false;
    }

    this.#window.push(pitch);
    if (this.#window.length > CONFIRM_FRAMES) this.#window.shift();
    if (this.#window.length < CONFIRM_FRAMES) return false;

    // Judge the window as a whole. Requiring every frame to be far away would
    // miss a real change the moment one frame lands near the old voice; judging
    // the median resists both that and the odd octave error.
    const windowPitch = median(this.#window);
    if (windowPitch === null) return false;
    if (centsBetween(windowPitch, this.#referencePitch) <= CHANGE_THRESHOLD_CENTS) return false;

    // The new voice becomes the reference, seeded from the window that
    // identified it, so the next change is judged against this speaker.
    this.#reference = [...this.#window];
    this.#referencePitch = windowPitch;
    this.#window = [];
    return true;
  }

  /** The pitch this detector currently considers the active voice. */
  referencePitch(): number | null {
    return this.#referencePitch;
  }

  reset(): void {
    this.#reference = [];
    this.#referencePitch = null;
    this.#window = [];
  }
}
