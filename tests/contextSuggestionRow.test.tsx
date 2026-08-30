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
      { text: 'help', symbol: '🆘' },
      { text: 'more', symbol: '➕' },
      { text: 'later', symbol: '⏳' },
    ],
    [
      { text: 'Water, please.', symbol: '💧' },
      { text: 'I am cold.', symbol: '🥶' },
      { text: 'Thank you.', symbol: '🙏' },
      { text: 'Please wait.', symbol: '⏳' },
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
    expect(choices).toHaveLength(6);
    expect(container.querySelector('.suggest-overlay')).toBeNull();

    act(() => choices[0]?.click());
    expect(store.getState().composition).toBe('water');
  });

  it('renders four phrases so the AI row matches the fixed phrase grid', () => {
    act(() => root.render(<ContextSuggestionRow mode="phrases" enabled />));
    expect(container.querySelectorAll('.context-cell')).toHaveLength(4);
    expect(container.querySelector('.context-row--phrases')).not.toBeNull();
  });
});
