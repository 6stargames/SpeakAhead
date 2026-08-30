import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contextAssistRequestKey,
  contextChoicesReadyForRefresh,
  REPLY_BATCH_SETTLE_MS,
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
    expect(route).toContain('generateSuggestions');
    expect(route).toContain('Return empty words and phrases arrays');
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
    act(() => vi.advanceTimersByTime(REPLY_BATCH_SETTLE_MS));
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
    act(() => vi.advanceTimersByTime(REPLY_BATCH_SETTLE_MS + 50));
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
      await vi.advanceTimersByTimeAsync(REPLY_BATCH_SETTLE_MS + 50);
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

  it('changes its work key only for finished attributed conversation turns', () => {
    const first = [{ id: 'one', final: true }];
    expect(contextAssistRequestKey(first, '')).toBe('one\u0000');
    expect(contextAssistRequestKey([...first, { id: 'live', final: false }], '')).toBe('one\u0000');
    expect(contextAssistRequestKey([...first, { id: 'two', final: true }], '')).toBe('two\u0000');
    expect(contextAssistRequestKey(first, 'hello')).toBe('one\u0000');
  });

  it('does not generate replies for the AAC user own voice', async () => {
    act(() => {
      actions.setSpeakers([{
        id: 'speaker-owner',
        label: 'You',
        pitchHz: 120,
        brightness: 0.08,
        utterances: 3,
        isOwner: true,
      }]);
      actions.upsertTurn({
        id: 'mine',
        source: 'user',
        text: 'Hell yeah.',
        final: true,
        dictated: true,
        speakerId: 'speaker-owner',
        words: [{ text: 'hell', confidence: 0.92 }, { text: 'yeah', confidence: 0.88 }],
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mocks.requestContextAssist).toHaveBeenCalledTimes(1);
    expect(mocks.requestContextAssist.mock.calls[0]?.[0]).toMatchObject({
      generateSuggestions: false,
    });
    expect(store.getState().assistFeatures.suggestions.tasks).toHaveLength(0);
    expect(store.getState().contextualWords).toHaveLength(0);
    expect(store.getState().contextualPhrases).toHaveLength(0);
  });

  it('does not revive an old pending reply batch after the user answers', async () => {
    act(() => {
      actions.upsertTurn({
        id: 'partner', source: 'peer', text: 'Would you like coffee?', final: true,
      });
      actions.upsertTurn({
        id: 'answered', source: 'user', text: 'No, thank you.', final: true, spoken: true,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REPLY_BATCH_SETTLE_MS + 100);
    });

    expect(mocks.requestContextAssist).not.toHaveBeenCalled();
    expect(store.getState().assistFeatures.suggestions.tasks).toHaveLength(0);
  });

  it('groups nearby turns from other people into one ten-choice reply batch', async () => {
    act(() => {
      actions.upsertTurn({
        id: 'partner-one', source: 'peer', text: 'Do you want to go out?', final: true,
      });
      vi.advanceTimersByTime(900);
      actions.upsertTurn({
        id: 'partner-two', source: 'peer', text: 'We could get lunch.', final: true,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REPLY_BATCH_SETTLE_MS + 50);
    });

    expect(mocks.requestContextAssist).toHaveBeenCalledTimes(1);
    expect(mocks.requestContextAssist.mock.calls[0]?.[0]).toMatchObject({
      generateSuggestions: true,
    });
    const task = store.getState().assistFeatures.suggestions.tasks[0];
    expect(task?.label).toContain('6 words + 4 phrases');
    expect(task?.label).toContain('Do you want to go out?');
    expect(task?.label).toContain('We could get lunch.');
    expect(task?.resultCount).toBe(10);
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
