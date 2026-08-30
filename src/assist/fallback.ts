import type { ContextSuggestion, Turn } from '@/state/store';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'him', 'his', 'i', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our',
  'she', 'so', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'was', 'we', 'were', 'with',
  'you', 'your',
]);

const SYMBOL_RULES: readonly [RegExp, string][] = [
  [/\b(help|nurse|doctor|pain|hurt)\b/i, '🆘'],
  [/\b(water|drink|thirst|tea|coffee|juice)\b/i, '💧'],
  [/\b(food|eat|hungry|lunch|dinner|breakfast)\b/i, '🍽️'],
  [/\b(yes|right|agree|okay)\b/i, '✅'],
  [/\b(no|not|wrong|stop)\b/i, '🚫'],
  [/\b(wait|time|later|moment)\b/i, '⏳'],
  [/\b(home|room|where|place)\b/i, '📍'],
  [/\b(why|what|question|understand)\b/i, '❓'],
  [/\b(call|phone|family|friend)\b/i, '📞'],
  [/\b(feel|happy|good|great)\b/i, '🙂'],
];

export function symbolForText(text: string): string {
  return SYMBOL_RULES.find(([pattern]) => pattern.test(text))?.[1] ?? '💬';
}

function wordsFrom(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? [];
}

export function localWordSuggestions(turns: readonly Pick<Turn, 'text'>[]): ContextSuggestion[] {
  const latest = turns.at(-1)?.text ?? '';
  const candidates = wordsFrom(latest)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .filter((word, index, list) => list.indexOf(word) === index)
    .slice(-6)
    .reverse();
  for (const fallback of ['yes', 'no', 'wait', 'please', 'again', 'later']) {
    if (candidates.length >= 6) break;
    if (!candidates.includes(fallback)) candidates.push(fallback);
  }
  return candidates.slice(0, 6).map((text) => ({ text, symbol: symbolForText(text) }));
}
