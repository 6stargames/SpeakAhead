import { getChatGPTUser } from '../../chatgpt-auth';

type RateEntry = { startedAt: number; count: number };

const rateWindows = new Map<string, RateEntry>();

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function requireAssistUser(limitPerMinute: number): Promise<
  | { ok: true; userId: string; apiKey: string }
  | { ok: false; response: Response }
> {
  const user = await getChatGPTUser();
  if (!user) return { ok: false, response: json({ error: 'chatgpt_sign_in_required' }, 401) };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { ok: false, response: json({ error: 'assist_not_configured' }, 503) };

  const now = Date.now();
  const entry = rateWindows.get(user.userId);
  if (!entry || now - entry.startedAt >= 60_000) {
    rateWindows.set(user.userId, { startedAt: now, count: 1 });
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

