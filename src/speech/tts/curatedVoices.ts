/**
 * A reviewed shortlist of the 904 LibriTTS-R voices.
 *
 * The bundled Piper model exposes every speaker as "Voice N", which is a
 * wall of anonymous numbers. This shortlist was curated by cross-referencing
 * the model's speaker map against the LibriVox reader records the corpus was
 * built from: the two most celebrated narrators in the corpus (Elizabeth
 * Klett and Mark F. Smith, both consistently praised for professional-grade
 * clarity), plus the voices the model's authors placed first in the speaker
 * map. First names only - the voice becomes the user's, not the narrator's.
 *
 * The full list remains available behind "All voices"; ears outrank any
 * shortlist, and the preview button exists so they can be used.
 */

export interface CuratedVoice {
  /** Matches the TTS provider's voice id (the speaker sid as a string). */
  readonly id: string;
  readonly name: string;
  readonly gender: 'female' | 'male';
  /**
   * Voices that do not read strongly as either - the Neutral choice on the
   * Voice type setting shows exactly these. A voice keeps its corpus gender
   * for the Male/Female lists; this flag is an additional judgement about
   * how it lands on the ear, and Danny's ears are the review board.
   */
  readonly neutralSounding?: boolean;
  readonly note: string;
}

export const CURATED_VOICES: readonly CuratedVoice[] = [
  { id: '582', name: 'Elizabeth', gender: 'female', note: 'Clear and expressive - a celebrated narrator' },
  { id: '9', name: 'Amanda', gender: 'female', neutralSounding: true, note: 'Warm, natural pacing' },
  { id: '0', name: 'Ashley', gender: 'female', neutralSounding: true, note: 'The model’s default voice - neutral and steady' },
  { id: '1', name: 'Jessica', gender: 'female', note: 'Bright and crisp' },
  { id: '546', name: 'Mark', gender: 'male', note: 'Rich and unhurried - a celebrated narrator' },
  { id: '8', name: 'Craig', gender: 'male', note: 'Deep and deliberate' },
  { id: '5', name: 'Steven', gender: 'male', note: 'Even, broadcast-like delivery' },
  { id: '2', name: 'Brett', gender: 'male', neutralSounding: true, note: 'Plain-spoken and direct' },
];
