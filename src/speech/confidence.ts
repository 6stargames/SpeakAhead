/**
 * Word-level recognition confidence.
 *
 * The transducer emits a log-probability for every token it decodes. Folded
 * into per-word confidences, they let the transcript mark the words the
 * decoder itself was unsure about - the spell-check squiggle, but for
 * hearing. The marking is honest in both directions: a clean word is left
 * alone, and a low-confidence word is flagged rather than silently presented
 * as fact, because a device that transcribes a room owes its user a visible
 * distinction between "heard" and "guessed".
 */

export interface WordConfidence {
  readonly text: string;
  /** exp(mean token log-prob): 1 is certain, near 0 is a guess. */
  readonly confidence: number;
}

/**
 * Below this, a word is marked as uncertain in the transcript. Initial value
 * chosen from the transducer's typical range (clean words decode near 0.8–1,
 * misheard ones fall well under 0.5); tune against field data.
 */
export const UNCERTAIN_BELOW = 0.5;

/**
 * Fold token log-probabilities into per-word confidences.
 *
 * BPE tokens mark word starts with a leading space or "▁"; everything else
 * continues the previous word. A word's confidence is the exponential of its
 * mean token log-prob - the geometric mean of the token probabilities, so
 * one bad token drags a long word honestly rather than being averaged away.
 *
 * Returns null when the evidence is missing or malformed; the caller renders
 * plain text.
 */
export function wordConfidences(
  tokens: readonly string[] | null | undefined,
  logProbs: readonly number[] | null | undefined,
): WordConfidence[] | null {
  if (!tokens || !logProbs || tokens.length === 0 || tokens.length !== logProbs.length) return null;

  const words: { text: string; sum: number; count: number }[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    const logProb = Number(logProbs[i]);
    if (!Number.isFinite(logProb)) return null;

    const startsWord = token.startsWith(' ') || token.startsWith('▁');
    const text = token.replace(/^[ ▁]+/, '');
    const last = words[words.length - 1];
    if (startsWord || !last) {
      words.push({ text, sum: logProb, count: 1 });
    } else {
      last.text += text;
      last.sum += logProb;
      last.count += 1;
    }
  }

  const result = words
    .filter((word) => word.text.length > 0)
    .map((word) => ({ text: word.text, confidence: Math.exp(word.sum / word.count) }));
  return result.length > 0 ? result : null;
}

/**
 * Pair display text with word confidences, tolerating the punctuation and
 * capitalisation that restoration added after recognition.
 *
 * Alignment is positional: the display text split on whitespace must have
 * exactly as many words as the confidence list, or no marking happens at all
 * - a misaligned squiggle under the wrong word is worse than none.
 */
export function alignWordsToText(
  displayText: string,
  words: readonly WordConfidence[] | null | undefined,
): { text: string; uncertain: boolean }[] | null {
  if (!words || words.length === 0) return null;
  const displayWords = displayText.split(/\s+/).filter((word) => word.length > 0);
  if (displayWords.length !== words.length) return null;
  return displayWords.map((text, index) => ({
    text,
    uncertain: (words[index] as WordConfidence).confidence < UNCERTAIN_BELOW,
  }));
}
