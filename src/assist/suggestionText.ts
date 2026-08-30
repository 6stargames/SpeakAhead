export type SuggestionMode = 'words' | 'phrases';

const EMOJI_PATTERN = /(?:[#*0-9]\uFE0F?\u20E3)|[\p{Extended_Pictographic}\p{Regional_Indicator}\u200D\uFE0E\uFE0F]/gu;
const SINGLE_WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/u;

/** Symbols live in their own visual field and must never reach speech output. */
export function withoutSpokenEmoji(text: string): string {
  return text
    .replace(EMOJI_PATTERN, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A Words-board choice is exactly one lexical word, never a mini phrase. */
export function suggestionText(text: string, mode: SuggestionMode): string {
  const clean = withoutSpokenEmoji(text);
  if (mode === 'phrases') return clean.slice(0, 140);
  return clean.match(SINGLE_WORD_PATTERN)?.[0]?.slice(0, 32) ?? '';
}
