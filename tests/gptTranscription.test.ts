import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeMonoWav, requestAccurateTranscription } from '@/speech/gptTranscription';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accurate transcription client', () => {
  it('encodes mono float frames as a valid 16-bit PCM WAV', async () => {
    const wav = encodeMonoWav([
      new Float32Array([-1, -0.5]),
      new Float32Array([0, 0.5, 1]),
    ], 16_000);
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(wav);
    });
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer);

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(52, true)).toBe(32_767);
  });

  it('posts one bounded WAV to the authenticated same-origin route', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      const audio = form.get('audio') as File;
      expect(audio.type).toBe('audio/wav');
      expect(audio.name).toBe('utterance.wav');
      expect(form.get('context')).toBe('Please call Danny.');
      expect(form.get('draft')).toBe('Please call Daniel.');
      return Response.json({
        text: 'Please call Danny.',
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestAccurateTranscription(
      [new Float32Array([0.1, 0.2, 0.1])],
      16_000,
      '  Please   call Danny.  ',
      '  Please   call Daniel.  ',
    );

    expect(fetchMock).toHaveBeenCalledWith('/api/assist/transcription', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
    }));
    expect(result).toEqual({
      text: 'Please call Danny.',
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
  });

  it('keeps the local transcript when the accuracy route fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })));
    await expect(requestAccurateTranscription(
      [new Float32Array([0.1])],
      16_000,
      '',
      'Local words.',
    )).resolves.toBeNull();
  });

  it('keeps the local transcript if a response exposes private context hints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      text: 'On-device draft: New words. Recent AAC conversation: Private older words.',
    })));

    await expect(requestAccurateTranscription(
      [new Float32Array([0.1])],
      16_000,
      'Private older words from the conversation.',
      'New words.',
    )).resolves.toBeNull();
  });

  it('raises quiet speech without clipping loud samples', async () => {
    const wav = encodeMonoWav([new Float32Array([0.01, -0.01, 0.02])], 16_000);
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(wav);
    });
    const view = new DataView(buffer);

    expect(Math.abs(view.getInt16(44, true))).toBeGreaterThan(2_000);
    expect(Math.abs(view.getInt16(48, true))).toBeLessThanOrEqual(32_767);
  });
});
