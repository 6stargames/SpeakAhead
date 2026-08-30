import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetThemedSymbolMemoryForTests } from '@/assist/themeIcons';
import { OutputRibbon } from '@/components/OutputRibbon';
import { VoicePanel } from '@/components/VoicePanel';
import { actions, store } from '@/state/store';

let container: HTMLDivElement;
let root: Root;
let imageSequence = 0;

function isLookup(init?: RequestInit): boolean {
  if (init?.method !== 'POST' || typeof init.body !== 'string') return false;
  return (JSON.parse(init.body) as { lookupOnly?: boolean }).lookupOnly === true;
}

function pngResponse(): Response {
  return new Response(new Uint8Array(256), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'x-aac-sprite-columns': '1',
      'x-aac-sprite-rows': '1',
      'x-aac-sprite-index': '0',
      'x-aac-image-source': 'generated',
    },
  });
}

beforeEach(() => {
  store.reset();
  resetThemedSymbolMemoryForTests();
  actions.setAccurateTranscriptionEnabled(true);
  actions.setSettings({
    symbolTheme: 'baby-shark',
    voiceGender: 'male',
    voiceId: 'chatgpt:cedar',
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  imageSequence = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:voice-art-${imageSequence += 1}`),
  });
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    isLookup(init) ? Response.json({ groups: [] }) : pngResponse(),
  ));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetThemedSymbolMemoryForTests();
  vi.unstubAllGlobals();
});

describe('Speak button voice artwork', () => {
  it('reuses the selected voice banner without another image request', async () => {
    act(() => root.render(<><VoicePanel /><OutputRibbon /></>));

    await vi.waitFor(() => {
      const selectedVoice = container.querySelector<HTMLButtonElement>('.voice-option[aria-pressed="true"]');
      const speak = container.querySelector<HTMLButtonElement>('.button--speak');
      expect(selectedVoice?.style.backgroundImage).toContain('blob:voice-art-');
      expect(speak?.style.backgroundImage).toBe(selectedVoice?.style.backgroundImage);
      expect(speak?.classList.contains('button--speak-pictured')).toBe(true);
    });

    const generatedBodies = (fetch as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, init]) => init?.method === 'POST' && typeof init.body === 'string' && !isLookup(init))
      .map(([, init]) => JSON.parse(init.body as string) as { items: { text: string }[] });
    expect(generatedBodies.filter((body) => body.items[0]?.text.includes('Cedar male voice name badge')))
      .toHaveLength(1);
  });
});
