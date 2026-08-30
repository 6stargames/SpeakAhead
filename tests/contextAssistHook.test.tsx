import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contextAssistRequestKey, useContextAssist } from '@/assist/useContextAssist';
import { actions, store } from '@/state/store';

const mocks = vi.hoisted(() => ({ requestContextAssist: vi.fn() }));

vi.mock('@/assist/client', () => ({
  requestContextAssist: mocks.requestContextAssist,
}));

function Harness(): null {
  useContextAssist(true);
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  store.reset();
  actions.setSettings({ chatGPTAssist: true });
  mocks.requestContextAssist.mockReset();
  mocks.requestContextAssist.mockResolvedValue({
    corrections: [],
    words: [
      { text: 'yes', symbol: '✅' },
      { text: 'no', symbol: '❌' },
      { text: 'wait', symbol: '⏳' },
    ],
    phrases: [
      { text: 'Yes, please.', symbol: '✅' },
      { text: 'No, thank you.', symbol: '❌' },
      { text: 'Please wait.', symbol: '⏳' },
    ],
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('continuous context assistance', () => {
  it('does not restart the language debounce for unfinished microphone updates', async () => {
    act(() => {
      actions.upsertTurn({
        id: 'finished',
        source: 'peer',
        text: 'Would you like water?',
        final: true,
        dictated: true,
      });
    });
    act(() => vi.advanceTimersByTime(250));
    act(() => {
      actions.upsertTurn({
        id: 'live',
        source: 'peer',
        text: 'I am still',
        final: false,
        dictated: true,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(mocks.requestContextAssist).toHaveBeenCalledTimes(1);
    expect(store.getState().contextualWords).toHaveLength(3);
    expect(store.getState().contextualPhrases).toHaveLength(3);
  });

  it('changes its work key only for finished conversation or composition changes', () => {
    const first = [{ id: 'one', final: true }];
    expect(contextAssistRequestKey(first, '')).toBe('one\u0000');
    expect(contextAssistRequestKey([...first, { id: 'live', final: false }], '')).toBe('one\u0000');
    expect(contextAssistRequestKey([...first, { id: 'two', final: true }], '')).toBe('two\u0000');
    expect(contextAssistRequestKey(first, 'hello')).toBe('one\u0000hello');
  });
});
