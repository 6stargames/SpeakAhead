import type { JSX } from 'react';
import { ThemedSymbol, themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import { session } from '@/session/AacSession';
import {
  actions,
  selectContextualPhrases,
  selectContextualWords,
  useStore,
  type AppState,
  type ContextSuggestion,
} from '@/state/store';

const selectAssistStatus = (state: AppState): AppState['assistStatus'] => state.assistStatus;

/**
 * Context choices belong on the board, not over it. This is a fixed first row
 * above Words or Phrases, so suggestions never cover vocabulary underneath.
 */
export function ContextSuggestionRow({
  mode,
  enabled,
  themedSymbolsEnabled = false,
}: {
  mode: 'words' | 'phrases';
  enabled: boolean;
  themedSymbolsEnabled?: boolean;
}): JSX.Element | null {
  const words = useStore(selectContextualWords);
  const phrases = useStore(selectContextualPhrases);
  const assistStatus = useStore(selectAssistStatus);
  const suggestions: ContextSuggestion[] = mode === 'words' ? words : phrases;
  const themedSymbols = useThemedSymbols(suggestions, themedSymbolsEnabled);

  if (!enabled) return null;

  return (
    <div
      className="context-row"
      role="group"
      aria-label={`AI-generated context ${mode}`}
      aria-live="polite"
      data-scan="grid"
    >
      {suggestions.length === 0 ? (
        <div className="context-row__empty">
          <span className="context-row__spark" aria-hidden="true">✨</span>
          <span>
            {assistStatus === 'thinking'
              ? `Preparing AI ${mode}…`
              : `AI ${mode} will appear here after the next spoken turn.`}
          </span>
        </div>
      ) : (
        suggestions.slice(0, 3).map((suggestion, index) => (
          <button
            type="button"
            className="cell context-cell"
            key={`${suggestion.text}-${index}`}
            title={suggestion.text}
            onClick={() => {
              if (mode === 'words') actions.appendComposition(suggestion.text);
              else void session.speak(suggestion.text);
            }}
          >
            <span className="context-cell__badge">AI</span>
            <ThemedSymbol
              symbol={suggestion.symbol}
              tile={themeTileFor(themedSymbols, suggestion)}
            />
            <span className="cell__word">{suggestion.text}</span>
          </button>
        ))
      )}
    </div>
  );
}
