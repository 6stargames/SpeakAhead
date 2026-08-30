import { UNCERTAIN_BELOW } from '@/speech/confidence';
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

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (current[j - 1] as number) + 1,
        (previous[j] as number) + 1,
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] as number;
}

function preserveTokenShape(original: string, replacement: string): string {
  const leading = original.match(/^\W*/u)?.[0] ?? '';
  const trailing = original.match(/\W*$/u)?.[0] ?? '';
  const bare = original.slice(leading.length, original.length - trailing.length || undefined);
  const cased = /^[A-Z]/.test(bare)
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement;
  return `${leading}${cased}${trailing}`;
}

/**
 * Conservative offline repair: only replace an uncertain word when a nearly
 * identical word was already used in the recent conversation. It deliberately
 * leaves novel words alone; the cloud checker can reason more broadly.
 */
export function localContextCorrection(
  turn: Pick<Turn, 'text' | 'words'>,
  priorTurns: readonly Pick<Turn, 'text'>[],
): { correctedText: string; reason: string } | null {
  if (!turn.words || turn.words.length === 0) return null;
  const display = turn.text.split(/\s+/).filter(Boolean);
  if (display.length !== turn.words.length) return null;

  const counts = new Map<string, number>();
  for (const prior of priorTurns) {
    for (const word of wordsFrom(prior.text)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  let changed = false;
  const corrected = display.map((token, index) => {
    const evidence = turn.words?.[index];
    if (!evidence || evidence.confidence >= UNCERTAIN_BELOW) return token;
    const heard = wordsFrom(evidence.text)[0] ?? '';
    if (heard.length < 3) return token;
    const candidates = [...counts.entries()]
      .filter(([candidate]) => candidate !== heard && candidate[0] === heard[0])
      .map(([candidate, frequency]) => ({ candidate, frequency, distance: editDistance(heard, candidate) }))
      .filter(({ candidate, frequency, distance }) =>
        distance === 1 || (distance === 2 && heard.length >= 7 && candidate.length >= 7 && frequency >= 2),
      )
      .sort((a, b) => a.distance - b.distance || b.frequency - a.frequency);
    const best = candidates[0];
    const runnerUp = candidates[1];
    if (!best || (runnerUp && runnerUp.distance === best.distance && runnerUp.frequency === best.frequency)) return token;
    changed = true;
    return preserveTokenShape(token, best.candidate);
  });

  return changed
    ? {
        correctedText: corrected.join(' '),
        reason: 'Matched an uncertain word to the recent conversation.',
      }
    : null;
}
