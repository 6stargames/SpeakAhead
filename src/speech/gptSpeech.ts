import type { ChatGptVoiceName } from './tts/voiceChoices';

export interface ChatGptSpeechResult {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly source: 'saved' | 'generated' | 'unknown';
}

interface SpeechRequestInput {
  readonly text: string;
  readonly voice: ChatGptVoiceName;
  readonly instructions: string;
  readonly rate: number;
}

const SPEECH_CACHE_NAME = 'speakahead-chatgpt-speech-v1';
const SPEECH_CACHE_PATH = '/_speakahead-cache/speech/';
const MAX_CACHED_SPEECH_CLIPS = 48;
const MAX_CACHED_SPEECH_BYTES = 4_000_000;
const inFlightSpeech = new Map<string, Promise<ChatGptSpeechResult | null>>();

function ascii(view: DataView, offset: number, length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}

/** Decode the PCM WAV returned by the same-origin ChatGPT speech route. */
export function decodeSpeechWav(buffer: ArrayBuffer): Omit<ChatGptSpeechResult, 'source'> | null {
  if (buffer.byteLength < 44) return null;
  const view = new DataView(buffer);
  if (ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') return null;

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const chunkId = ascii(view, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + chunkLength > view.byteLength) return null;
    if (chunkId === 'fmt ' && chunkLength >= 16) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = body;
      dataLength = chunkLength;
    }
    offset = body + chunkLength + (chunkLength % 2);
  }

  if (dataOffset < 0 || channels < 1 || channels > 2 || sampleRate < 8_000) return null;
  if (!((format === 1 && bitsPerSample === 16) || (format === 3 && bitsPerSample === 32))) return null;
  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * channels));
  if (frames <= 0) return null;
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let mixed = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = dataOffset + (frame * channels + channel) * bytesPerSample;
      mixed += format === 1
        ? view.getInt16(offset, true) / 0x8000
        : view.getFloat32(offset, true);
    }
    samples[frame] = Math.max(-1, Math.min(1, mixed / channels));
  }
  return { samples, sampleRate };
}

function normaliseInput(
  text: string,
  voice: ChatGptVoiceName,
  instructions: string,
  rate: number,
): SpeechRequestInput {
  return {
    text: text.replace(/\s+/g, ' ').trim().slice(0, 2_000),
    voice,
    instructions: instructions.replace(/\s+/g, ' ').trim().slice(0, 240),
    rate: Number.isFinite(rate) ? Math.max(0.7, Math.min(1.35, rate)) : 1,
  };
}

function signature(input: SpeechRequestInput): string {
  return JSON.stringify(input);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function cacheRequest(input: SpeechRequestInput): Promise<Request | null> {
  if (typeof caches === 'undefined' || !globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(signature(input)),
  );
  const origin = typeof location === 'undefined' ? 'https://speakahead.invalid' : location.origin;
  return new Request(`${origin}${SPEECH_CACHE_PATH}${hex(new Uint8Array(digest))}.wav`);
}

async function readCachedSpeech(input: SpeechRequestInput): Promise<ChatGptSpeechResult | null> {
  try {
    const request = await cacheRequest(input);
    if (!request) return null;
    const response = await (await caches.open(SPEECH_CACHE_NAME)).match(request);
    if (!response?.headers.get('content-type')?.startsWith('audio/wav')) return null;
    const decoded = decodeSpeechWav(await response.arrayBuffer());
    return decoded ? { ...decoded, source: 'saved' } : null;
  } catch {
    return null;
  }
}

async function saveCachedSpeech(input: SpeechRequestInput, bytes: ArrayBuffer): Promise<void> {
  if (bytes.byteLength > MAX_CACHED_SPEECH_BYTES) return;
  try {
    const request = await cacheRequest(input);
    if (!request) return;
    const cache = await caches.open(SPEECH_CACHE_NAME);
    await cache.put(request, new Response(bytes.slice(0), {
      headers: {
        'content-type': 'audio/wav',
        'x-aac-cached-at': String(Date.now()),
      },
    }));
    const keys = await cache.keys();
    await Promise.all(keys
      .slice(0, Math.max(0, keys.length - MAX_CACHED_SPEECH_CLIPS))
      .map((key) => cache.delete(key)));
  } catch {
    /* Persistent playback caching is an optimization, never a requirement. */
  }
}

async function fetchSpeech(input: SpeechRequestInput): Promise<ChatGptSpeechResult | null> {
  const cached = await readCachedSpeech(input);
  if (cached) return cached;

  try {
    // Deliberately do not attach a playback AbortSignal here. Stopping or changing
    // a preview must not cancel an already-paid generation before it can be saved.
    const response = await fetch('/api/assist/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/wav' },
      credentials: 'same-origin',
      body: JSON.stringify(input),
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/wav')) return null;
    const bytes = await response.arrayBuffer();
    const decoded = decodeSpeechWav(bytes);
    if (!decoded) return null;
    await saveCachedSpeech(input, bytes);
    const value = response.headers.get('x-aac-speech-source');
    const source = value === 'saved' || value === 'generated' ? value : 'unknown';
    return { ...decoded, source };
  } catch {
    return null;
  }
}

function waitForPlayback(
  result: Promise<ChatGptSpeechResult | null>,
  signal?: AbortSignal,
): Promise<ChatGptSpeechResult | null> {
  if (!signal) return result;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const stopWaiting = () => resolve(null);
    signal.addEventListener('abort', stopWaiting, { once: true });
    void result.then((value) => {
      signal.removeEventListener('abort', stopWaiting);
      resolve(value);
    });
  });
}

export async function requestChatGptSpeech(
  text: string,
  voice: ChatGptVoiceName,
  instructions: string,
  rate: number,
  signal?: AbortSignal,
): Promise<ChatGptSpeechResult | null> {
  const input = normaliseInput(text, voice, instructions, rate);
  if (!input.text || !input.instructions) return null;
  const key = signature(input);
  let request = inFlightSpeech.get(key);
  if (!request) {
    request = fetchSpeech(input);
    inFlightSpeech.set(key, request);
    void request.finally(() => {
      if (inFlightSpeech.get(key) === request) inFlightSpeech.delete(key);
    });
  }
  return waitForPlayback(request, signal);
}
