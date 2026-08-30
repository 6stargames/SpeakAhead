import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VoicePanel } from '@/components/VoicePanel';
import { actions, store } from '@/state/store';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  store.reset();
  actions.setAccurateTranscriptionEnabled(true);
  actions.setSettings({ symbolTheme: 'emoji', voiceGender: 'neutral' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function names(): string[] {
  return [...container.querySelectorAll<HTMLElement>('.voice-option__name')]
    .map((element) => element.textContent ?? '');
}

describe('Voice page', () => {
  it('shows only the six neutral choices selected in Settings', () => {
    act(() => root.render(<VoicePanel />));

    expect(container.querySelector('.voice-list')?.getAttribute('data-voice-gender')).toBe('neutral');
    expect(container.querySelectorAll('.voice-option')).toHaveLength(6);
    expect(names()).toEqual(['Ashley', 'Alloy', 'Brett', 'Marin', 'Amanda', 'Sage']);
    expect(container.querySelectorAll('.voice-option--device')).toHaveLength(3);
    expect(container.querySelectorAll('.voice-option--chatgpt')).toHaveLength(3);
  });

  it('switches the visible six rather than combining all 18 choices', () => {
    act(() => root.render(<VoicePanel />));

    act(() => actions.setSettings({ voiceGender: 'female' }));
    expect(container.querySelectorAll('.voice-option')).toHaveLength(6);
    expect(names()).toEqual(['Elizabeth', 'Coral', 'Amanda', 'Nova', 'Jessica', 'Shimmer']);

    act(() => actions.setSettings({ voiceGender: 'male' }));
    expect(container.querySelectorAll('.voice-option')).toHaveLength(6);
    expect(names()).toEqual(['Mark', 'Cedar', 'Craig', 'Onyx', 'Steven', 'Echo']);
  });

  it('keeps the button layout but hides OpenAI choices when signed out', () => {
    act(() => actions.setAccurateTranscriptionEnabled(false));
    act(() => root.render(<VoicePanel />));

    expect(container.querySelectorAll('.voice-option')).toHaveLength(3);
    expect(container.querySelectorAll('.voice-option--chatgpt')).toHaveLength(0);
  });

  it('does not offer a This is me control for voices heard in the room', () => {
    act(() => actions.setSpeakers([{
      id: 'speaker-1',
      label: 'Speaker 1',
      pitchHz: 150,
      brightness: 0.08,
      utterances: 1,
      isOwner: false,
    }]));
    act(() => root.render(<VoicePanel />));

    expect(container.textContent).not.toContain('This is me');
    expect(container.textContent).not.toContain('mark your own voice');
    expect(container.textContent).toContain('Forget');
  });
});
