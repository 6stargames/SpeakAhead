import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contextAssistRequestKey,
  contextChoicesReadyForRefresh,
  THEMED_CONTEXT_HOLD_MS,
  useContextAssist,
} from '@/assist/useContextAssist';
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
      { text: 'please', symbol: '🙏' },
      { text: 'again', symbol: '🔁' },
      { text: 'later', symbol: '⏳' },
    ],
    phrases: [
      { text: 'I agree.', symbol: '✅' },
      { text: 'Not now, please.', symbol: '❌' },
      { text: 'Tell me more.', symbol: '💬' },
      { text: 'What happens next?', symbol: '❓' },
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
  it('reserves enough structured-output budget for the correction pass', async () => {
    const route = await readFile(resolve(process.cwd(), 'app/api/assist/context/route.ts'), 'utf8');
    expect(route).toContain("reasoning: { effort: 'minimal' }");
    expect(route).toContain('max_output_tokens: 2_000');
    expect(route).toContain('minItems: 6');
    expect(route).toContain('minItems: 4');
  });

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
    expect(store.getState().contextualWords).toHaveLength(6);
    expect(store.getState().contextualPhrases).toHaveLength(4);
  });

  it('finishes one request and then drains only the newest pending turn', async () => {
    let finishFirst: ((value: unknown) => void) | undefined;
    const firstResponse = new Promise((resolve) => {
      finishFirst = resolve;
    });
    const generated = {
      corrections: [],
      words: [
        { text: 'yes', symbol: '✅' },
        { text: 'no', symbol: '❌' },
        { text: 'wait', symbol: '⏳' },
        { text: 'please', symbol: '🙏' },
        { text: 'again', symbol: '🔁' },
        { text: 'later', symbol: '⏳' },
      ],
      phrases: [
        { text: 'I agree.', symbol: '✅' },
        { text: 'Not now, please.', symbol: '❌' },
        { text: 'Tell me more.', symbol: '💬' },
        { text: 'What happens next?', symbol: '❓' },
      ],
    };
    mocks.requestContextAssist
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValue(generated);

    act(() => {
      actions.upsertTurn({
        id: 'first', source: 'peer', text: 'First turn', final: true, dictated: true,
      });
    });
    act(() => vi.advanceTimersByTime(500));
    expect(mocks.requestContextAssist).toHaveBeenCalledTimes(1);

    act(() => {
      actions.upsertTurn({
        id: 'second', source: 'peer', text: 'Second turn', final: true, dictated: true,
      });
      actions.upsertTurn({
        id: 'third', source: 'peer', text: 'Newest turn', final: true, dictated: true,
      });
      vi.advanceTimersByTime(10_000);
    });
    expect(mocks.requestContextAssist).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirst?.(generated);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mocks.requestContextAssist).toHaveBeenCalledTimes(2);
    const secondRequest = mocks.requestContextAssist.mock.calls[1]?.[0] as {
      turns: { id: string }[];
      excludedWords: string[];
      excludedPhrases: string[];
    };
    expect(secondRequest.turns.at(-1)?.id).toBe('third');
    expect(secondRequest.excludedWords).toContain('yes');
    expect(secondRequest.excludedPhrases).toContain('I agree.');
  });

  it('changes its work key only for finished conversation or composition changes', () => {
    const first = [{ id: 'one', final: true }];
    expect(contextAssistRequestKey(first, '')).toBe('one\u0000');
    expect(contextAssistRequestKey([...first, { id: 'live', final: false }], '')).toBe('one\u0000');
    expect(contextAssistRequestKey([...first, { id: 'two', final: true }], '')).toBe('two\u0000');
    expect(contextAssistRequestKey(first, 'hello')).toBe('one\u0000hello');
  });

  it('holds themed choices steady while their pictures are being generated', () => {
    actions.setSettings({ symbolTheme: 'hello-kitty' });
    actions.setContextSuggestions(
      [{ text: 'water', symbol: '💧' }],
      [{ text: 'Water, please.', symbol: '💧' }],
    );
    const state = store.getState();

    expect(contextChoicesReadyForRefresh(state, state.contextSuggestionsUpdatedAt + 1_000)).toBe(false);
    expect(
      contextChoicesReadyForRefresh(state, state.contextSuggestionsUpdatedAt + THEMED_CONTEXT_HOLD_MS),
    ).toBe(true);

    actions.setSettings({ symbolTheme: 'emoji' });
    expect(contextChoicesReadyForRefresh(store.getState(), state.contextSuggestionsUpdatedAt + 1_000)).toBe(true);
  });
});
