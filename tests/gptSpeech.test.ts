import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeSpeechWav, requestChatGptSpeech } from '@/speech/gptSpeech';

function monoWav(
  samples: readonly number[],
  sampleRate = 24_000,
  streamingLengths = false,
): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, streamingLengths ? 0xffff_ffff : 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, streamingLengths ? 0xffff_ffff : samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return buffer;
}

function speechCache() {
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, response.clone());
    }),
    keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
    delete: vi.fn(async (request: Request) => entries.delete(request.url)),
  };
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
  return cache;
}

afterEach(() => vi.unstubAllGlobals());

describe('ChatGPT speech client', () => {
  it('decodes the routed PCM WAV into samples', () => {
    const result = decodeSpeechWav(monoWav([-32_768, 0, 16_384, 32_767]));
    expect(result?.sampleRate).toBe(24_000);
    expect(result?.samples).toHaveLength(4);
    expect(result?.samples[0]).toBe(-1);
    expect(result?.samples[2]).toBeCloseTo(0.5);
  });

  it('decodes a streamed WAV whose final lengths were unknown in its header', () => {
    const result = decodeSpeechWav(monoWav([-32_768, 0, 16_384, 32_767], 24_000, true));
    expect(result?.sampleRate).toBe(24_000);
    expect(result?.samples).toHaveLength(4);
    expect(result?.samples[0]).toBe(-1);
    expect(result?.samples[2]).toBeCloseTo(0.5);
  });

  it('requests a signed-in voice and reports whether it was newly generated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(monoWav([0, 100, -100]), {
      status: 200,
      headers: {
        'content-type': 'audio/wav',
        'x-aac-speech-source': 'generated',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestChatGptSpeech(
      'Hello there.',
      'marin',
      'Speak naturally.',
      1,
    );

    expect(fetchMock).toHaveBeenCalledWith('/api/assist/speech', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
    }));
    expect(result?.source).toBe('generated');
    expect(result?.sampleRate).toBe(24_000);
  });

  it('keeps the device path available when the speech route fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })));
    await expect(requestChatGptSpeech('Hello.', 'cedar', 'Speak clearly.', 1)).resolves.toBeNull();
  });

  it('plays an exact repeated phrase from the persistent device cache', async () => {
    speechCache();
    const fetchMock = vi.fn().mockResolvedValue(new Response(monoWav([0, 200, -200]), {
      status: 200,
      headers: {
        'content-type': 'audio/wav',
        'x-aac-speech-source': 'generated',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await requestChatGptSpeech('  Same   phrase. ', 'marin', ' Speak naturally. ', 1);
    await Promise.resolve();
    const repeated = await requestChatGptSpeech('Same phrase.', 'marin', 'Speak naturally.', 1);

    expect(first?.source).toBe('generated');
    expect(repeated?.source).toBe('saved');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('finishes and caches generation after playback is canceled', async () => {
    const cache = speechCache();
    let finishRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
      finishRequest = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const canceledPlayback = requestChatGptSpeech(
      'Do not waste this generation.',
      'cedar',
      'Speak clearly.',
      1,
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    await expect(canceledPlayback).resolves.toBeNull();

    finishRequest?.(new Response(monoWav([0, 300, -300]), {
      status: 200,
      headers: {
        'content-type': 'audio/wav',
        'x-aac-speech-source': 'generated',
      },
    }));
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    const repeated = await requestChatGptSpeech(
      'Do not waste this generation.',
      'cedar',
      'Speak clearly.',
      1,
    );

    expect(repeated?.source).toBe('saved');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('signal');
  });
});
