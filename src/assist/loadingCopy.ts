import type { SymbolTheme } from './pictureThemes';

export interface LoadingCopyResponse {
  readonly text: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
}

function tokenCount(record: Record<string, unknown>, key: string): number {
  return Number.isFinite(record[key]) ? Math.max(0, Math.floor(Number(record[key]))) : 0;
}

function parseLoadingCopy(value: unknown): LoadingCopyResponse | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.text !== 'string') return null;
  const text = record.text.replace(/\s+/g, ' ').trim().slice(0, 48).trim();
  if (text.length < 2) return null;
  const usageRecord = record.usage && typeof record.usage === 'object'
    ? record.usage as Record<string, unknown>
    : null;
  const usage = usageRecord
    ? {
      inputTokens: tokenCount(usageRecord, 'inputTokens'),
      outputTokens: tokenCount(usageRecord, 'outputTokens'),
      totalTokens: tokenCount(usageRecord, 'totalTokens'),
    }
    : undefined;
  return { text, ...(usage ? { usage } : {}) };
}

/** Fetch one text-only line through the authenticated loading-copy route. */
export async function requestLoadingCopy(
  theme: SymbolTheme,
  signal?: AbortSignal,
): Promise<LoadingCopyResponse | null> {
  try {
    const response = await fetch('/api/assist/loading-copy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ theme }),
      credentials: 'same-origin',
      signal,
    });
    if (!response.ok) return null;
    return parseLoadingCopy(await response.json());
  } catch {
    return null;
  }
}
