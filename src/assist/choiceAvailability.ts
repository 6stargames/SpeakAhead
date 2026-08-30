import type { SuggestionMode } from './suggestionText';

/** Choices that are already permanently available on the two AAC boards. */
export const CORE_WORD_TEXTS = [
  'I', 'you', 'he', 'she', 'it', 'they',
  'want', 'go', 'stop', 'make', 'get', 'put',
  'look', 'turn', 'do', 'help', 'open', 'not',
  'good', 'bad', 'same', 'different', 'more', 'all',
  'in', 'on', 'up', 'down', 'here', 'finished',
  'who', 'what', 'where', 'when', 'why', 'how',
] as const;

export const FIXED_PHRASE_TEXTS = [
  'I need help right now.',
  'I am in pain.',
  'I cannot breathe well.',
  'Please call a nurse.',
  'Please call my family.',
  'Something is wrong.',
  'Please stop.',
  'I need the bathroom.',
  'I would like some water, please.',
  'I am hungry.',
  'I am cold.',
  'I am hot.',
  'I am tired.',
  'I would like to sit up.',
  'I would like to lie down.',
  'Could you adjust my pillow?',
  'Hello, good to see you.',
  'Thank you very much.',
  'Yes, please.',
  'No, thank you.',
  'Please wait a moment.',
  'Could you repeat that?',
  'I am listening.',
  'Goodbye for now.',
  'Please slow down a little.',
  'I need more time to answer.',
  'Let me finish, please.',
  'I did not understand that.',
  'That is right.',
  'That is not what I meant.',
  'Can we talk about this later?',
  'I have something to say.',
] as const;

export interface ChoiceText {
  readonly text: string;
}

/** Case, punctuation, and repeated whitespace do not make a choice new. */
export function normalizedChoice(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSameWord(candidate: string, available: string): boolean {
  return normalizedChoice(candidate) === normalizedChoice(available);
}

function isSamePhrase(candidate: string, available: string): boolean {
  const next = normalizedChoice(candidate);
  const existing = normalizedChoice(available);
  if (!next || !existing) return false;
  if (next === existing) return true;

  // A shortened or extended version of an existing multi-word button is not
  // a genuinely new choice (for example, "I need help" versus the permanent
  // "I need help right now" button).
  const shorter = next.length <= existing.length ? next : existing;
  const longer = next.length <= existing.length ? existing : next;
  return shorter.split(' ').length >= 2 && longer.startsWith(`${shorter} `);
}

export function choiceAlreadyAvailable(
  text: string,
  mode: SuggestionMode,
  additionalAvailable: readonly string[] = [],
): boolean {
  const permanent = mode === 'words' ? CORE_WORD_TEXTS : FIXED_PHRASE_TEXTS;
  const compare = mode === 'words' ? isSameWord : isSamePhrase;
  return [...permanent, ...additionalAvailable].some((available) => compare(text, available));
}

/**
 * Last line of defence for every source of contextual choices: OpenAI, WebMCP,
 * and the on-device fallback all pass through the same availability rule.
 */
export function filterNovelChoices<T extends ChoiceText>(
  items: readonly T[],
  mode: SuggestionMode,
  additionalAvailable: readonly string[] = [],
  limit = Number.POSITIVE_INFINITY,
): T[] {
  const accepted: T[] = [];
  const unavailable = [...additionalAvailable];
  for (const item of items) {
    if (!normalizedChoice(item.text)) continue;
    if (choiceAlreadyAvailable(item.text, mode, unavailable)) continue;
    accepted.push(item);
    unavailable.push(item.text);
    if (accepted.length >= limit) break;
  }
  return accepted;
}

/**
 * Phrases are generated as word tokens, then joined here. The model can no
 * longer accidentally collapse "I agree" into "Iagree" in the UI.
 */
export function joinPhraseTokens(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .flatMap((token) => (typeof token === 'string' ? token.trim().split(/\s+/) : []))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}
