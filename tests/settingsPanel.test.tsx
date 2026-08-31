import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetThemedSymbolMemoryForTests } from '@/assist/themeIcons';
import { SettingsPanel } from '@/components/SettingsPanel';
import { actions, store } from '@/state/store';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  store.reset();
  resetThemedSymbolMemoryForTests();
  actions.setSettings({ symbolTheme: 'emoji', voiceGender: 'neutral', voiceId: 'chatgpt:alloy' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetThemedSymbolMemoryForTests();
  vi.unstubAllGlobals();
});

function clickVoiceType(label: string): void {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim().endsWith(label));
  if (!button) throw new Error(`Missing voice type button: ${label}`);
  act(() => button.click());
}

describe('Settings voice type', () => {
  it('moves an OpenAI selection to the newly selected voice type', () => {
    act(() => root.render(<SettingsPanel signedIn symbolTheme="emoji" />));

    clickVoiceType('Female');

    expect(store.getState().settings.voiceGender).toBe('female');
    expect(store.getState().settings.voiceId).toBe('chatgpt:coral');
  });

  it('moves a device selection to the newly selected voice type', () => {
    act(() => actions.setSettings({ voiceId: '0' }));
    act(() => root.render(<SettingsPanel signedIn symbolTheme="emoji" />));

    clickVoiceType('Male');

    expect(store.getState().settings.voiceGender).toBe('male');
    expect(store.getState().settings.voiceId).toBe('546');
  });

  it('keeps a device voice shared with the new group selected', () => {
    act(() => actions.setSettings({ voiceGender: 'female', voiceId: '9' }));
    act(() => root.render(<SettingsPanel signedIn symbolTheme="emoji" />));

    clickVoiceType('Neutral');

    expect(store.getState().settings.voiceGender).toBe('neutral');
    expect(store.getState().settings.voiceId).toBe('9');
  });

  it('opens the researched picture styles and keeps Done docked in the picker', () => {
    act(() => root.render(<SettingsPanel signedIn symbolTheme="emoji" />));

    const primaryEmoji = container.querySelector<HTMLButtonElement>('button[aria-label="Emoji"]');
    expect(primaryEmoji?.getAttribute('aria-pressed')).toBe('true');
    expect(primaryEmoji?.querySelector('.option__selected-check')?.textContent).toBe('✓');

    const viewMore = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'View more');
    expect(viewMore).toBeDefined();
    expect(container.textContent).toContain('Ghibli Style');

    act(() => viewMore?.click());

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const moreEmoji = container.querySelector<HTMLButtonElement>('button[aria-label="Emoji"]');
    expect(moreEmoji).not.toBeNull();
    expect(moreEmoji?.getAttribute('aria-pressed')).toBe('true');
    expect(moreEmoji?.querySelector('.option__selected-check')?.textContent).toBe('✓');
    expect(container.textContent).toContain('Claymation');
    expect(container.textContent).toContain('Pixel Art');
    expect(container.textContent).toContain('Mid-Century');
    const done = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'DONE');
    expect(done?.classList.contains('theme-more__done')).toBe(true);

    const pixelArt = container.querySelector<HTMLButtonElement>('button[aria-label="Pixel Art"]');
    act(() => pixelArt?.click());
    expect(store.getState().settings.symbolTheme).toBe('pixel-art');
    expect(pixelArt?.getAttribute('aria-pressed')).toBe('true');
    expect(pixelArt?.querySelector('.option__selected-check')?.textContent).toBe('✓');

    act(() => done?.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('What kind of voice?');
  });

  it('shows the selected researched theme above View more with its checkmark', () => {
    act(() => actions.setSettings({ symbolTheme: 'halo-3' }));
    act(() => root.render(<SettingsPanel signedIn symbolTheme="halo-3" />));

    const stack = container.querySelector('.theme-option-stack');
    const halo = stack?.querySelector<HTMLButtonElement>('button[aria-label="HALO 3"]');
    const viewMore = [...(stack?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.trim() === 'View more');

    expect(halo).not.toBeNull();
    expect(halo?.getAttribute('aria-pressed')).toBe('true');
    expect(halo?.querySelector('.option__selected-check')?.textContent).toBe('✓');
    expect(stack?.querySelector('button[aria-label="Emoji"]')).toBeNull();
    expect(viewMore?.getAttribute('aria-pressed')).toBeNull();
    expect(viewMore?.querySelector('.option__selected-check')).toBeNull();
  });

  it('keeps one mixed gender-choice picture set while other setting art follows the user', async () => {
    const generatedBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : null;
      if (body?.lookupOnly === true) return Response.json({ groups: [] });
      if (body) generatedBodies.push(body);
      return new Response(new Uint8Array(256), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'x-aac-sprite-columns': '3',
          'x-aac-sprite-rows': '3',
          'x-aac-sprite-index': '0',
          'x-aac-image-source': 'generated',
        },
      });
    }));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:settings-theme'),
    });
    act(() => actions.setSettings({ symbolTheme: 'hello-kitty', voiceGender: 'male' }));
    act(() => root.render(<SettingsPanel signedIn symbolTheme="hello-kitty" />));

    const generatedFor = (prefix: string) => generatedBodies.filter((body) => (
      Array.isArray(body.items) && body.items.some((item) => (
        typeof item === 'object' && item !== null &&
        String((item as { text?: unknown }).text ?? '').startsWith(prefix)
      ))
    ));

    await vi.waitFor(() => {
      expect(generatedFor('What kind of voice?')).toHaveLength(1);
      expect(generatedFor('How fast should it talk?').some((body) => (
        body.audienceGender === 'male'
      ))).toBe(true);
    });
    expect(generatedFor('What kind of voice?')[0]?.audienceGender).toBe('neutral');

    clickVoiceType('Female');
    await vi.waitFor(() => {
      expect(generatedFor('How fast should it talk?').some((body) => (
        body.audienceGender === 'female'
      ))).toBe(true);
    });

    expect(generatedFor('What kind of voice?')).toHaveLength(1);
    expect(generatedFor('What kind of voice?')[0]?.audienceGender).toBe('neutral');
  });
});
