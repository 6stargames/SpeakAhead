import type { CaptureChannel } from '@/audio/AudioGraph';

/**
 * Keeps one chat turn attached to one acoustic utterance.
 *
 * A recogniser can report the same endpoint more than once: once from its own
 * decoder and again when the outer VAD catches up. The first final result used
 * to release the turn id immediately, so the second report minted a new bubble
 * above the GPT-confirmed one. Keeping stable ids for numbered utterances makes
 * those late reports idempotent while preserving the legacy active-turn
 * behaviour for providers that cannot supply an utterance id.
 */
export class RecognitionTurnTracker {
  static readonly #MAX_REMEMBERED_UTTERANCES = 256;

  readonly #createTurnId: () => string;
  readonly #turnIds = new Map<string, string>();

  constructor(createTurnId: () => string) {
    this.#createTurnId = createTurnId;
  }

  resolve(channel: CaptureChannel, utteranceId?: number): string {
    const key = this.#key(channel, utteranceId);
    const existing = this.#turnIds.get(key);
    if (existing) return existing;

    const turnId = this.#createTurnId();
    this.#turnIds.set(key, turnId);
    this.#prune();
    return turnId;
  }

  /**
   * Legacy providers identify only the currently open turn, so they release it
   * at final. Numbered Sherpa utterances remain remembered for late duplicates.
   */
  finalize(channel: CaptureChannel, utteranceId?: number): void {
    if (!this.#numbered(utteranceId)) this.#turnIds.delete(this.#key(channel));
  }

  reset(channel: CaptureChannel): void {
    const prefix = `utterance:${channel}:`;
    this.#turnIds.delete(this.#key(channel));
    for (const key of this.#turnIds.keys()) {
      if (key.startsWith(prefix)) this.#turnIds.delete(key);
    }
  }

  #key(channel: CaptureChannel, utteranceId?: number): string {
    return this.#numbered(utteranceId)
      ? `utterance:${channel}:${utteranceId}`
      : `active:${channel}`;
  }

  #numbered(utteranceId?: number): utteranceId is number {
    return Number.isSafeInteger(utteranceId) && (utteranceId ?? 0) > 0;
  }

  #prune(): void {
    if (this.#turnIds.size <= RecognitionTurnTracker.#MAX_REMEMBERED_UTTERANCES) return;
    for (const key of this.#turnIds.keys()) {
      if (!key.startsWith('utterance:')) continue;
      this.#turnIds.delete(key);
      if (this.#turnIds.size <= RecognitionTurnTracker.#MAX_REMEMBERED_UTTERANCES) return;
    }
  }
}
