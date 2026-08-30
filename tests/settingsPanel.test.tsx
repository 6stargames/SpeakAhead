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
});
