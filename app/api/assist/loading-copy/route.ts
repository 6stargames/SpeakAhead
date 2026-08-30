import { ALL_PICTURE_THEMES, normaliseSymbolTheme } from '@/assist/pictureThemes';
import { json, postOpenAIJson, readSmallJson, requireAssistUser } from '../server';

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', minLength: 2, maxLength: 48 },
  },
  required: ['text'],
} as const;

function outputText(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'output_text' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return null;
}

function responseUsage(response: unknown): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} | null {
  if (!response || typeof response !== 'object') return null;
  const usage = (response as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return null;
  const record = usage as Record<string, unknown>;
  const count = (key: string) => Number.isFinite(record[key])
    ? Math.max(0, Math.floor(Number(record[key])))
    : 0;
  return {
    inputTokens: count('input_tokens'),
    outputTokens: count('output_tokens'),
    totalTokens: count('total_tokens'),
  };
}

function cleanLoadingText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u2013\u2014]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, '')
    .trim()
    .slice(0, 48)
    .trim();
  return text.length >= 2 ? text : null;
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAssistUser('loading-copy', 12);
  if (!auth.ok) return auth.response;

  let themeValue: unknown;
  try {
    const body = await readSmallJson(request, 1_000);
    themeValue = body && typeof body === 'object'
      ? (body as Record<string, unknown>).theme
      : null;
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const theme = normaliseSymbolTheme(themeValue);
  if (!theme) return json({ error: 'invalid_request' }, 400);
  const themeLabel = ALL_PICTURE_THEMES.find((option) => option.value === theme)?.label ?? 'Emoji';

  const model = process.env.OPENAI_TEXT_MODEL?.trim() || 'gpt-5-mini';
  let upstream: Response;
  try {
    upstream = await postOpenAIJson(
      'https://api.openai.com/v1/responses',
      auth.apiKey,
      {
        model,
        store: false,
        reasoning: { effort: 'minimal' },
        instructions: [
          'Write one fresh, witty loading status for an accessible speech app.',
          'It appears only while the on-device speech recognizer reaches 100 percent.',
          'Use two to five plain words and at most 32 characters.',
          'Gently evoke the supplied visual style without naming it directly.',
          'Return text only. Do not mention pictures, AI, loading, percentages, or getting ready.',
          'Do not use emoji, quotation marks, an en dash, or an em dash.',
          'Avoid copyrighted catchphrases and never give instructions.',
          'Use the variation token only to make this wording different from earlier requests.',
        ].join(' '),
        input: JSON.stringify({
          visualStyle: themeLabel,
          variationToken: crypto.randomUUID(),
        }),
        max_output_tokens: 256,
        text: {
          format: {
            type: 'json_schema',
            name: 'aac_loading_copy',
            strict: true,
            schema: responseSchema,
          },
        },
      },
      10_000,
    );
  } catch {
    return json({ error: 'assist_upstream_unavailable' }, 502);
  }
  if (!upstream.ok) {
    console.error('[aac] OpenAI loading copy failed', upstream.status);
    return json({ error: 'assist_upstream_failed' }, 502);
  }

  const upstreamBody = await upstream.json();
  const output = outputText(upstreamBody);
  if (!output) return json({ error: 'assist_invalid_response' }, 502);
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const text = cleanLoadingText(parsed.text);
    if (!text) return json({ error: 'assist_invalid_response' }, 502);
    const usage = responseUsage(upstreamBody);
    return json({ text, ...(usage ? { usage } : {}) });
  } catch {
    return json({ error: 'assist_invalid_response' }, 502);
  }
}
