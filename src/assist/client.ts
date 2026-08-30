import type { ContextAssistRequest, ContextAssistResponse } from './types';
import { filterNovelChoices } from './choiceAvailability';
import { suggestionText, type SuggestionMode } from './suggestionText';

function suggestion(value: unknown, mode: SuggestionMode): { text: string; symbol: string } | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.text !== 'string' || typeof item.symbol !== 'string') return null;
  const text = suggestionText(item.text, mode);
  const symbol = item.symbol.trim().slice(0, 16);
  return text && symbol ? { text, symbol } : null;
}

function suggestions(value: unknown, mode: SuggestionMode, max: number): { text: string; symbol: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => suggestion(item, mode))
    .filter((item): item is { text: string; symbol: string } => item !== null)
    .filter((item, index, list) =>
      list.findIndex((candidate) => candidate.text.toLocaleLowerCase() === item.text.toLocaleLowerCase()) === index,
    )
    .slice(0, max);
}

function parseResponse(value: unknown, request: ContextAssistRequest): ContextAssistResponse | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const corrections = Array.isArray(record.corrections)
    ? record.corrections
        .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === 'object')
        .filter(
          (candidate) =>
            typeof candidate.turnId === 'string' &&
            typeof candidate.originalText === 'string' &&
            typeof candidate.correctedText === 'string' &&
            typeof candidate.reason === 'string',
        )
        .map((candidate) => ({
          turnId: candidate.turnId as string,
          originalText: candidate.originalText as string,
          correctedText: candidate.correctedText as string,
          reason: candidate.reason as string,
        }))
        .slice(0, 4)
    : [];
  const words = filterNovelChoices(
    suggestions(record.words, 'words', 6),
    'words',
    request.excludedWords,
    6,
  );
  const phrases = filterNovelChoices(
    suggestions(record.phrases, 'phrases', 4),
    'phrases',
    request.excludedPhrases,
    4,
  );
  if (request.generateSuggestions && words.length === 0 && phrases.length === 0 && corrections.length === 0) {
    return null;
  }
  return { corrections, words, phrases };
}

/**
 * Ask the signed-in, same-origin server route for text-only assistance.
 * Authentication and the OpenAI secret stay on the server; the browser never
 * receives either one.
 */
export async function requestContextAssist(
  request: ContextAssistRequest,
  signal?: AbortSignal,
): Promise<ContextAssistResponse | null> {
  try {
    const response = await fetch('/api/assist/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
      credentials: 'same-origin',
      signal,
    });
    if (!response.ok) return null;
    return parseResponse(await response.json(), request);
  } catch {
    return null;
  }
}
