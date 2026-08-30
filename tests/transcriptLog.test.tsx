import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptLog } from '@/components/TranscriptLog';
import { actions, store } from '@/state/store';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-30T20:00:00Z'));
  store.reset();
  store.set({
    asr: { status: 'ready', implementation: 'sherpa-onnx', offline: true },
    tts: { status: 'ready', implementation: 'sherpa-onnx', offline: true },
    micActive: true,
    accurateTranscriptionEnabled: true,
  });
  actions.addTurn('user', 'Hello there.', { dictated: false, spoken: true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('transient chat labels', () => {
  it('shortens the listening status and removes You said after a few seconds', () => {
    act(() => root.render(<TranscriptLog />));

    expect(container.textContent).toContain('You said');
    expect(container.querySelector('.listening-bar__label')?.textContent).toBe('Listening · ONNX + GPT');

    act(() => vi.advanceTimersByTime(4_100));

    expect(container.textContent).not.toContain('You said');
    expect(container.querySelector('.listening-bar__label')?.textContent).toBe('Listening');
  });

  it('marks speech heard from a shared tab with a small play icon', () => {
    actions.addTurn('peer', 'Audio from the video.', {
      dictated: true,
      audioSource: 'browser-tab',
    });

    act(() => root.render(<TranscriptLog />));

    expect(container.textContent).toContain('Tab audio said');
    expect(container.querySelector('[aria-label="From shared tab audio"]')?.textContent).toBe('▶');
  });

  it('shows the recognised speaker name on a finished shared-tab message', () => {
    actions.setSpeakers([{
      id: 'speaker-7',
      label: 'Speaker 7',
      pitchHz: 180,
      brightness: 0.08,
      utterances: 2,
      isOwner: false,
    }]);
    actions.upsertTurn({
      id: 'tab-speaker-turn',
      source: 'peer',
      text: 'A second person joined the video.',
      final: true,
      dictated: true,
      spoken: false,
      audioSource: 'browser-tab',
      speakerId: 'speaker-7',
    });

    act(() => root.render(<TranscriptLog />));

    expect(container.textContent).toContain('Speaker 7 said');
    expect(container.querySelector('[aria-label="From shared tab audio"]')?.textContent).toBe('▶');
  });

  it('shows separate room and tab waveform lanes while both sources are active', () => {
    act(() => store.set({ tabAudioActive: true }));
    act(() => root.render(<TranscriptLog />));

    expect(container.querySelector('[data-audio-channel="local"]')).not.toBeNull();
    expect(container.querySelector('[data-audio-channel="tab"]')).not.toBeNull();
    expect(container.querySelector('.listening-bar__waves--split')?.textContent).toContain('Room');
    expect(container.querySelector('.listening-bar__waves--split')?.textContent).toContain('Tab');
  });
});
