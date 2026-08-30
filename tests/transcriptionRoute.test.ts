import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/chatgpt-auth', () => ({
  getChatGPTUser: vi.fn(async () => ({
    userId: 'user-test',
    displayName: 'Test User',
    email: 'test@example.com',
    fullName: 'Test User',
  })),
}));

import { POST } from '../app/api/assist/transcription/route';

const originalApiKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_TRANSCRIPTION_MODEL;

function transcriptionRequest(context = '', draft = ''): Request {
  const form = new FormData();
  form.set('audio', new File([new Uint8Array(64)], 'utterance.wav', { type: 'audio/wav' }));
  if (context) form.set('context', context);
  if (draft) form.set('draft', draft);
  return { formData: async () => form } as Request;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_TRANSCRIPTION_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  if (originalModel === undefined) delete process.env.OPENAI_TRANSCRIPTION_MODEL;
  else process.env.OPENAI_TRANSCRIPTION_MODEL = originalModel;
});

describe('accurate transcription route', () => {
  it('sends one English WAV using the documented transcription form', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get('model')).toBe('gpt-transcribe');
      expect(form.get('language')).toBeNull();
      expect(form.get('languages[]')).toBe('en');
      expect(form.get('response_format')).toBe('json');
      expect(form.get('prompt')).toContain('Please call Danny.');
      expect(form.get('prompt')).toContain('Please call Daniel.');
      return Response.json({ text: 'Please call Danny.' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(transcriptionRequest('Please call Danny.', 'Please call Daniel.'));

    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: 'Please call Danny.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to GPT-4o Mini Transcribe when the primary model is rejected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const models: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      models.push(String(form.get('model')));
      if (models.length === 1) {
        return Response.json(
          { error: { code: 'model_not_found', message: 'not available' } },
          { status: 404 },
        );
      }
      return Response.json({ text: 'The accurate sentence.' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(transcriptionRequest());

    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: 'The accurate sentence.' });
    expect(models).toEqual(['gpt-transcribe', 'gpt-4o-mini-transcribe']);
  });

  it('tries another GPT transcription model when the first result is empty', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const models: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      models.push(String(form.get('model')));
      if (models.length === 1) return Response.json({ text: '' });
      expect(form.get('language')).toBe('en');
      expect(form.get('languages[]')).toBeNull();
      return Response.json({ text: 'The recovered sentence.' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(transcriptionRequest('', 'The recovered sentence.'));

    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: 'The recovered sentence.' });
    expect(models).toEqual(['gpt-transcribe', 'gpt-4o-mini-transcribe']);
  });

  it('uses the full GPT transcription fallback after two model failures', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const models: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      models.push(String(form.get('model')));
      if (models.length < 3) {
        return Response.json(
          { error: { code: 'model_not_found', message: 'not available' } },
          { status: 404 },
        );
      }
      return Response.json({ text: 'Recovered by GPT-4o Transcribe.' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(transcriptionRequest());

    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: 'Recovered by GPT-4o Transcribe.' });
    expect(models).toEqual([
      'gpt-transcribe',
      'gpt-4o-mini-transcribe',
      'gpt-4o-transcribe',
    ]);
  });
});
