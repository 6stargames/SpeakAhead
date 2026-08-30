import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/chatgpt-auth', () => ({
  getChatGPTUser: vi.fn(async () => ({
    userId: 'user-test',
    displayName: 'Test User',
    email: 'test@example.com',
    fullName: 'Test User',
  })),
}));

import { POST } from '../app/api/assist/loading-copy/route';

const originalApiKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

describe('loading copy route', () => {
  it('requests one fresh text-only line for the selected style', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: 'gpt-5-mini',
        store: false,
        reasoning: { effort: 'minimal' },
      });
      expect(String(body.input)).toContain('HALO 3');
      expect(String(body.instructions)).toContain('Return text only');
      expect(String(body.instructions)).toContain('Do not mention pictures');
      return Response.json({
        output: [{ content: [{ type: 'output_text', text: JSON.stringify({ text: 'Calibrating the comms' }) }] }],
        usage: { input_tokens: 20, output_tokens: 6, total_tokens: 26 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(new Request('https://example.test/api/assist/loading-copy', {
      method: 'POST',
      body: JSON.stringify({ theme: 'halo-3' }),
    }));

    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toEqual({
      text: 'Calibrating the comms',
      usage: { inputTokens: 20, outputTokens: 6, totalTokens: 26 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown style before making an OpenAI request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(new Request('https://example.test/api/assist/loading-copy', {
      method: 'POST',
      body: JSON.stringify({ theme: 'not-a-theme' }),
    }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
