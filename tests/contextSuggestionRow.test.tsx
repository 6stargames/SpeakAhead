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
      { text: 'later', symbol: '⏳' },
      { text: 'again', symbol: '🔁' },
      { text: 'ready', symbol: '✅' },
    ],
    [
      { text: 'I agree with you.', symbol: '✅' },
      { text: 'Let us continue.', symbol: '➡️' },
      { text: 'That sounds useful.', symbol: '💡' },
      { text: 'I have another idea.', symbol: '💬' },
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

    const choices = container.querySelectorAll<HTMLButtonElement>('.context-row--latest .context-cell');
    expect(choices).toHaveLength(6);
    expect(container.querySelector('.suggest-overlay')).toBeNull();

    act(() => choices[0]?.click());
    expect(store.getState().composition).toBe('water');
  });

  it('uses full board cards without generation labels and lets every choice be starred', () => {
    act(() => root.render(<ContextSuggestionRow mode="words" enabled />));

    const cards = container.querySelectorAll('.context-row .context-cellwrap');
    const labels = Array.from(container.querySelectorAll('.context-row .context-cell'))
      .map((card) => card.textContent);
    const favorite = container.querySelector<HTMLButtonElement>(
      '.context-row--latest .cell__fav[aria-label="Keep \\"water\\" in Favs"]',
    );

    expect(cards).toHaveLength(6);
    expect(labels.every((label) => !label?.includes('AI') && !label?.includes('Earlier'))).toBe(true);
    expect(favorite?.textContent).toBe('☆');

    act(() => favorite?.click());
    expect(store.getState().favorites.map((item) => item.text)).toContain('water');
    expect(favorite?.getAttribute('aria-pressed')).toBe('true');
    expect(favorite?.textContent).toBe('★');
  });

  it('renders four phrases so the AI row matches the fixed phrase grid', () => {
    act(() => root.render(<ContextSuggestionRow mode="phrases" enabled />));
    expect(container.querySelectorAll('.context-row--latest .context-cell')).toHaveLength(4);
    expect(container.querySelector('.context-row--phrases')).not.toBeNull();
    expect(container.querySelector('.context-row--previous.context-row--reserved')).not.toBeNull();
    expect(container.querySelectorAll('.context-row--previous .context-cell--placeholder')).toHaveLength(4);
  });

  it('reserves a complete dashed second row before the first word suggestions arrive', () => {
    act(() => actions.setContextSuggestions([], []));
    act(() => root.render(<ContextSuggestionRow mode="words" enabled />));

    expect(container.textContent).toContain('AI words will appear here after the next spoken turn.');
    expect(container.querySelector('.context-row__spark .cell__symbol')?.textContent).toBe('✨');
    expect(container.querySelectorAll('.context-row--previous .context-cell--placeholder')).toHaveLength(6);
  });

  it('bumps the last generation into the second row when new choices arrive', () => {
    act(() => root.render(<ContextSuggestionRow mode="words" enabled />));
    act(() => {
      actions.setContextSuggestions(
        [
          { text: 'yes', symbol: '✅' },
          { text: 'no', symbol: '🚫' },
          { text: 'wait', symbol: '⏳' },
          { text: 'maybe', symbol: '🤔' },
          { text: 'today', symbol: '📅' },
          { text: 'tomorrow', symbol: '🌅' },
        ],
        [
          { text: 'Maybe we can try again.', symbol: '🔁' },
          { text: 'I want to know more.', symbol: '💬' },
          { text: 'That makes sense to me.', symbol: '✅' },
          { text: 'We can decide later.', symbol: '⏳' },
        ],
      );
    });

    const latest = container.querySelectorAll('.context-row--latest .context-cell');
    const previous = container.querySelectorAll('.context-row--previous .context-cell');
    expect(latest).toHaveLength(6);
    expect(previous).toHaveLength(6);
    expect(latest[0]?.textContent).toContain('yes');
    expect(previous[0]?.textContent).toContain('water');
  });
});
