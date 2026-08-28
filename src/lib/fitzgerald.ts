/**
 * The Modified Fitzgerald Key, as a contract.
 *
 * Colour states the part of speech everywhere it appears — boards, folders,
 * editing, scanning highlights. New surfaces extend this set; nothing may
 * improvise colours beside it.
 */
export type FitzgeraldClass =
  | 'pronoun'
  | 'verb'
  | 'descriptor'
  | 'noun'
  | 'social'
  | 'question'
  | 'emergency';

export const FITZGERALD_LABELS: Record<FitzgeraldClass, string> = {
  pronoun: 'Person / pronoun (yellow)',
  verb: 'Action / verb (green)',
  descriptor: 'Describing word (blue)',
  noun: 'Thing / noun (orange)',
  social: 'Social / preposition (pink)',
  question: 'Question word (purple)',
  emergency: 'Emergency (red)',
};
