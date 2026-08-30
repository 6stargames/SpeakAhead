import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsPanel } from '@/components/SettingsPanel';
import { actions, store } from '@/state/store';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  store.reset();
  actions.setSettings({ symbolTheme: 'emoji', voiceGender: 'neutral', voiceId: 'chatgpt:alloy' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
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

    const viewMore = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'View more');
    expect(viewMore).toBeDefined();
    expect(container.textContent).toContain('Ghibli Style');

    act(() => viewMore?.click());

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain('Claymation');
    expect(container.textContent).toContain('Pixel Art');
    expect(container.textContent).toContain('Mid-Century');
    const done = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'DONE');
    expect(done?.classList.contains('theme-more__done')).toBe(true);

    const pixelArt = container.querySelector<HTMLButtonElement>('button[aria-label="Pixel Art"]');
    act(() => pixelArt?.click());
    expect(store.getState().settings.symbolTheme).toBe('pixel-art');

    act(() => done?.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('What kind of voice?');
  });
});
