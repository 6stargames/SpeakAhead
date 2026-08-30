import { CORE_WORD_TEXTS, FIXED_PHRASE_TEXTS, normalizedChoice } from './choiceAvailability';

export type ThemeImageCacheScope = 'shared' | 'private';

const PERMANENT_SHARED_CHOICES = new Set(
  [...CORE_WORD_TEXTS, ...FIXED_PHRASE_TEXTS].map(normalizedChoice),
);

const GENERIC_SHARED_PHRASES = new Set([
  'i agree',
  'i disagree',
  'i do not know',
  'i understand',
  'not now please',
  'tell me more',
  'what happens next',
  'can you help me',
  'please wait',
  'please say that again',
  'that sounds good',
  'maybe later',
  'let us do that',
].map(normalizedChoice));

const PRIVATE_DETAIL_PATTERNS = [
  /https?:\/\/|www\.|@/i,
  /\b(?:password|passcode|pin|account|routing|credit\s*card|social\s*security|ssn)\b/i,
  /\b(?:address|email|phone|telephone|birthday|date\s+of\s+birth)\b/i,
  /\b(?:my|our)\s+(?:name|address|email|phone|doctor|nurse|hospital|room|account|family|friend)\b/i,
  /\b(?:i|we)\s+(?:live|work|am\s+from|are\s+from)\b/i,
] as const;

const WORD_PATTERN = /^\p{Ll}[\p{L}'’-]{0,31}$/u;
const PHRASE_CHARACTER_PATTERN = /^[\p{L}\p{M}'’.,!?;:\-\s]+$/u;

function containsLikelyProperName(text: string): boolean {
  const words = text.match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu) ?? [];
  return words.some((word, index) => {
    if (index === 0 || word === 'I') return false;
    return /^\p{Lu}/u.test(word);
  });
}

/**
 * Shared pictures are limited to compact, generic language. Anything that
 * resembles an identifier, contact detail, proper name, or personal record
 * remains in the signed-in user's private image library.
 */
export function themeImageCacheScope(text: string): ThemeImageCacheScope {
  const clean = text.normalize('NFKC').trim();
  const normalized = normalizedChoice(clean);
  if (!normalized) return 'private';
  if (PERMANENT_SHARED_CHOICES.has(normalized) || GENERIC_SHARED_PHRASES.has(normalized)) {
    return 'shared';
  }
  if (
    clean.length > 72 ||
    PRIVATE_DETAIL_PATTERNS.some((pattern) => pattern.test(clean)) ||
    /\d/.test(clean)
  ) return 'private';

  const words = normalized.split(' ');
  if (words.length === 1) {
    return WORD_PATTERN.test(clean) ? 'shared' : 'private';
  }
  if (
    words.length <= 6 &&
    PHRASE_CHARACTER_PATTERN.test(clean) &&
    !containsLikelyProperName(clean)
  ) return 'shared';
  return 'private';
}

export function themeImageCacheOwner(userId: string, text: string): string {
  return themeImageCacheScope(text) === 'shared' ? 'shared' : `user:${userId}`;
}
