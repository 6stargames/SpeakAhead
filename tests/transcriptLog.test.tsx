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
});
