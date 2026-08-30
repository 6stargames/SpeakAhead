import type { JSX } from 'react';
import { ThemedSymbol, themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import { session } from '@/session/AacSession';
import { withoutSpokenEmoji } from '@/assist/suggestionText';
import {
  actions,
  selectContextualPhrases,
  selectContextualWords,
  selectPreviousContextualPhrases,
  selectPreviousContextualWords,
  useStore,
  type AppState,
  type ContextSuggestion,
  type SymbolTheme,
} from '@/state/store';

const selectAssistStatus = (state: AppState): AppState['assistStatus'] => state.assistStatus;

/**
 * Context choices belong on the board, not over it. This is a fixed first row
 * above Words or Phrases, so suggestions never cover vocabulary underneath.
 */
export function ContextSuggestionRow({
  mode,
  enabled,
  symbolTheme = 'emoji',
}: {
  mode: 'words' | 'phrases';
  enabled: boolean;
  symbolTheme?: SymbolTheme;
}): JSX.Element | null {
  const words = useStore(selectContextualWords);
  const phrases = useStore(selectContextualPhrases);
  const previousWords = useStore(selectPreviousContextualWords);
  const previousPhrases = useStore(selectPreviousContextualPhrases);
  const assistStatus = useStore(selectAssistStatus);
  const suggestions: ContextSuggestion[] = mode === 'words' ? words : phrases;
  const previousSuggestions: ContextSuggestion[] = mode === 'words' ? previousWords : previousPhrases;
  const themedSymbols = useThemedSymbols(suggestions, symbolTheme);
  const previousThemedSymbols = useThemedSymbols(previousSuggestions, symbolTheme);
  const limit = mode === 'words' ? 6 : 4;

  if (!enabled) return null;

  return (
    <div
      className="context-stack"
      role="group"
      aria-label={`AI-generated context ${mode}, newest row first`}
    >
      {([
        { items: suggestions, tiles: themedSymbols, generation: 'latest' as const },
        { items: previousSuggestions, tiles: previousThemedSymbols, generation: 'previous' as const },
      ]).map(({ items, tiles, generation }) => (
        <div
          className={`context-row context-row--${mode} context-row--${generation}${
            generation === 'previous' && items.length === 0 ? ' context-row--reserved' : ''
          }`}
          role="group"
          aria-label={generation === 'latest' ? `Latest AI ${mode}` : `Previous AI ${mode}`}
          aria-live={generation === 'latest' ? 'polite' : undefined}
          aria-hidden={generation === 'previous' && items.length === 0 ? true : undefined}
          data-scan={items.length > 0 ? 'grid' : undefined}
          key={`${generation}:${items.map((item) => item.text).join('\u0001')}`}
        >
          {generation === 'latest' && items.length === 0 ? (
            <div className="context-row__empty">
              <span className="context-row__spark" aria-hidden="true">✨</span>
              <span>
                {assistStatus === 'thinking'
                  ? `Preparing AI ${mode}…`
                  : `AI ${mode} will appear here after the next spoken turn.`}
              </span>
            </div>
          ) : (
            items.slice(0, limit).map((suggestion, index) => (
              <button
                type="button"
                className="cell context-cell"
                key={`${suggestion.text}-${index}`}
                title={suggestion.text}
                onClick={() => {
                  if (mode === 'words') actions.appendComposition(suggestion.text);
                  else void session.speak(withoutSpokenEmoji(suggestion.text));
                }}
              >
                <span className="context-cell__badge">
                  {generation === 'latest' ? 'AI' : 'Earlier'}
                </span>
                <ThemedSymbol
                  symbol={suggestion.symbol}
                  tile={themeTileFor(tiles, suggestion)}
                />
                <span className="cell__word">{suggestion.text}</span>
              </button>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
