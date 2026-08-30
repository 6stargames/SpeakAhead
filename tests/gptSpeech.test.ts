import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeSpeechWav, requestChatGptSpeech } from '@/speech/gptSpeech';

function monoWav(samples: readonly number[], sampleRate = 24_000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
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
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return buffer;
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
});
