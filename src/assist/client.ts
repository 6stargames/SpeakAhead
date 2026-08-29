import type { ContextAssistRequest, ContextAssistResponse } from './types';

function isSuggestion(value: unknown): value is { text: string; symbol: string } {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.text === 'string' &&
    item.text.trim().length > 0 &&
    item.text.length <= 180 &&
    typeof item.symbol === 'string' &&
    item.symbol.trim().length > 0 &&
    item.symbol.length <= 16
  );
}

function parseResponse(value: unknown): ContextAssistResponse | null {
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
  const words = Array.isArray(record.words) ? record.words.filter(isSuggestion).slice(0, 3) : [];
  const phrases = Array.isArray(record.phrases) ? record.phrases.filter(isSuggestion).slice(0, 3) : [];
  if (words.length === 0 && phrases.length === 0 && corrections.length === 0) return null;
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
    return parseResponse(await response.json());
  } catch {
    return null;
  }
}

