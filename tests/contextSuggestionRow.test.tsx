import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextSuggestionRow } from '@/components/ContextSuggestionRow';
import { SuggestionStrip } from '@/components/SuggestionStrip';
import { actions, store } from '@/state/store';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  store.reset();
  actions.setContextSuggestions(
    [
      { text: 'water', symbol: '💧' },
      { text: 'cold', symbol: '🥶' },
      { text: 'please', symbol: '🙏' },
    ],
    [
      { text: 'Water, please.', symbol: '💧' },
      { text: 'I am cold.', symbol: '🥶' },
      { text: 'Thank you.', symbol: '🙏' },
    ],
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AI context board row', () => {
  it('renders words as a first-row surface and never in the corner overlay', () => {
    act(() => {
      root.render(
        <>
          <ContextSuggestionRow mode="words" enabled />
          <SuggestionStrip />
        </>,
      );
    });

    const choices = container.querySelectorAll<HTMLButtonElement>('.context-cell');
    expect(choices).toHaveLength(3);
    expect(container.querySelector('.suggest-overlay')).toBeNull();

    act(() => choices[0]?.click());
    expect(store.getState().composition).toBe('water');
  });
});
