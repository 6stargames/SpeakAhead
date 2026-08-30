/**
 * Lightweight punctuation and casing restoration.
 *
 * Streaming transducers emit lower-case, unpunctuated text - "the quick brown
 * fox jumps over the lazy dog". The specification's preferred fix is a second
 * decoding pass with an offline model; this is what runs when no such model is
 * installed. It is cosmetic, applied only to display and to synthesis input,
 * and never to the text used for matching or context.
 *
 * Punctuation matters more here than it looks. A synthesiser reads an
 * unpunctuated sentence as one flat breath, which is markedly harder for a
 * listener to follow - and being easy to follow is the entire point.
 */

const ALWAYS_CAPITALISED = new Set(['i', "i'm", "i've", "i'll", "i'd"]);

const QUESTION_STARTERS =
  /^(who|what|when|where|why|how|which|whose|is|are|was|were|do|does|did|can|could|will|would|should|may|might|have|has|had|am|shall)\b/i;

export function restorePunctuation(text: string): string {
  let trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return '';

  // Several Zipformer models emit uppercase throughout. Left alone it reads as
  // shouting, which is a poor way to represent someone's speech - and worse on
  // a device whose whole job is to convey what a person meant.
  if (trimmed === trimmed.toUpperCase() && /[A-Z]{2,}/.test(trimmed)) {
    trimmed = trimmed.toLowerCase();
  }

  const words = trimmed.split(' ').map((word) => {
    const lower = word.toLowerCase();
    return ALWAYS_CAPITALISED.has(lower) ? lower.charAt(0).toUpperCase() + lower.slice(1) : word;
  });

  let sentence = words.join(' ');
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);

  if (!/[.!?]$/.test(sentence)) {
    sentence += QUESTION_STARTERS.test(sentence) ? '?' : '.';
  }
  return sentence;
}

/** Strip the cosmetic layer back off when text is used for matching. */
export function normaliseForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
