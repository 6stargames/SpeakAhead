import { getChatGPTUser } from '../../chatgpt-auth';

type RateEntry = { startedAt: number; count: number };
export type AssistRateBucket = 'context' | 'theme-icons';

const rateWindows = new Map<string, RateEntry>();
const RETRYABLE_OPENAI_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function requireAssistUser(
  bucket: AssistRateBucket,
  limitPerMinute: number,
): Promise<
  | { ok: true; userId: string; apiKey: string }
  | { ok: false; response: Response }
> {
  const user = await getChatGPTUser();
  if (!user) return { ok: false, response: json({ error: 'chatgpt_sign_in_required' }, 401) };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { ok: false, response: json({ error: 'assist_not_configured' }, 503) };

  const now = Date.now();
  // Image batches and language passes are independent work. Sharing one
  // counter made a busy anime board consume the context checker's allowance.
  const rateKey = `${bucket}\u0000${user.userId}`;
  const entry = rateWindows.get(rateKey);
  if (!entry || now - entry.startedAt >= 60_000) {
    rateWindows.set(rateKey, { startedAt: now, count: 1 });
  } else {
    entry.count += 1;
    if (entry.count > limitPerMinute) {
      return { ok: false, response: json({ error: 'assist_rate_limited' }, 429) };
    }
  }

  // Isolates are short lived, but cap the best-effort map so it can never grow
  // without bound in a warm worker.
  if (rateWindows.size > 2_000) {
    for (const [key, value] of rateWindows) {
      if (now - value.startedAt >= 60_000) rateWindows.delete(key);
    }
  }

  return { ok: true, userId: user.userId, apiKey };
}

export async function readSmallJson(request: Request, maxBytes = 30_000): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('request_too_large');
  return JSON.parse(text);
}

export function openAIHeaders(apiKey: string): HeadersInit {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(3_000, retryAfter * 1_000);
  }
  return 500 * (attempt + 1);
}

/** One quiet retry keeps a transient upstream failure from killing a pass. */
export async function postOpenAIJson(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: openAIHeaders(apiKey),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok || !RETRYABLE_OPENAI_STATUSES.has(response.status) || attempt === 1) {
        return response;
      }
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
    } catch (error) {
      lastError = error;
      if (attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('openai_request_failed');
}
