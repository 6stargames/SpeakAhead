import { env, type R2Bucket } from 'cloudflare:workers';
import { CHATGPT_VOICE_NAMES, type ChatGptVoiceName } from '@/speech/tts/voiceChoices';
import { json, postOpenAIJson, readSmallJson, requireAssistUser } from '../server';

const VOICES = new Set<ChatGptVoiceName>(CHATGPT_VOICE_NAMES);
const MAX_TEXT_LENGTH = 2_000;
const CACHE_VERSION = 'v1';

function speechInput(value: unknown): {
  text: string;
  voice: ChatGptVoiceName;
  instructions: string;
  rate: number;
} | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const text = typeof body.text === 'string'
    ? body.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH)
    : '';
  const voice = typeof body.voice === 'string' && VOICES.has(body.voice as ChatGptVoiceName)
    ? body.voice as ChatGptVoiceName
    : null;
  const instructions = typeof body.instructions === 'string'
    ? body.instructions.replace(/\s+/g, ' ').trim().slice(0, 240)
    : '';
  const requestedRate = Number(body.rate);
  const rate = Number.isFinite(requestedRate) ? Math.max(0.7, Math.min(1.35, requestedRate)) : 1;
  return text && voice && instructions ? { text, voice, instructions, rate } : null;
}

function bucket(): R2Bucket | null {
  try {
    return env.THEME_IMAGES ?? null;
  } catch {
    return null;
  }
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function cacheKey(input: ReturnType<typeof speechInput>, model: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify({ version: CACHE_VERSION, model, input })),
  );
  return `speech/${CACHE_VERSION}/${hex(new Uint8Array(digest))}.wav`;
}

function audioResponse(body: BodyInit, source: 'saved' | 'generated'): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'audio/wav',
      'x-aac-speech-source': source,
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAssistUser('speech', 60);
  if (!auth.ok) return auth.response;

  let input: ReturnType<typeof speechInput>;
  try {
    input = speechInput(await readSmallJson(request, 8_000));
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  if (!input) return json({ error: 'invalid_request' }, 400);

  const model = process.env.OPENAI_SPEECH_MODEL?.trim() || 'gpt-4o-mini-tts';
  const key = await cacheKey(input, model);
  const store = bucket();
  if (store) {
    try {
      const saved = await store.get(key);
      if (saved) return audioResponse(saved.body as BodyInit, 'saved');
    } catch {
      /* A cache miss still has a safe generated path. */
    }
  }

  const pace = input.rate < 0.88
    ? 'Use a slower, unhurried pace.'
    : input.rate > 1.12
      ? 'Use a brisk pace while keeping every word clear.'
      : 'Use a natural conversational pace.';
  let upstream: Response;
  try {
    upstream = await postOpenAIJson(
      'https://api.openai.com/v1/audio/speech',
      auth.apiKey,
      {
        model,
        voice: input.voice,
        input: input.text,
        instructions: `${input.instructions} ${pace}`,
        response_format: 'wav',
      },
      30_000,
    );
  } catch {
    return json({ error: 'speech_upstream_unavailable' }, 502);
  }
  if (!upstream.ok) {
    console.error('[aac] OpenAI speech generation failed', upstream.status);
    await upstream.body?.cancel();
    return json({ error: 'speech_upstream_failed' }, 502);
  }

  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength < 44 || bytes.byteLength > 20_000_000) {
    return json({ error: 'speech_invalid_response' }, 502);
  }
  if (store) {
    try {
      await store.put(key, bytes, {
        httpMetadata: { contentType: 'audio/wav', cacheControl: 'private, max-age=31536000, immutable' },
      });
    } catch {
      /* Playback should not fail because reusable storage is temporarily unavailable. */
    }
  }
  return audioResponse(bytes, 'generated');
}
