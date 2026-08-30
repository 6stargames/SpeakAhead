import type { CSSProperties, JSX } from 'react';
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
const selectFavorites = (state: AppState) => state.favorites;

export const CONTEXT_READY_THEME_ITEM = {
  text: 'AI suggestions ready',
  symbol: '✨',
  presentation: 'control-icon',
} as const;

export const CONTEXT_BANNER_THEME_ITEMS = {
  words: {
    text: 'AI words banner',
    symbol: '🔤',
    presentation: 'button-background',
  },
  phrases: {
    text: 'AI phrases banner',
    symbol: '💬',
    presentation: 'button-background',
  },
} as const;

export const CONTEXT_DIVIDER_THEME_ITEMS = {
  words: {
    text: 'AI words wallpaper divider',
    symbol: '▬',
    presentation: 'wallpaper-background',
  },
  phrases: {
    text: 'AI phrases wallpaper divider',
    symbol: '▬',
    presentation: 'wallpaper-background',
  },
} as const;

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
  const favorites = useStore(selectFavorites);
  const suggestions: ContextSuggestion[] = mode === 'words' ? words : phrases;
  const previousSuggestions: ContextSuggestion[] = mode === 'words' ? previousWords : previousPhrases;
  const themedSymbols = useThemedSymbols(suggestions, symbolTheme);
  const previousThemedSymbols = useThemedSymbols(previousSuggestions, symbolTheme);
  const readyTiles = useThemedSymbols([CONTEXT_READY_THEME_ITEM], symbolTheme, {
    batchSize: 1,
    singleSubject: true,
  });
  const bannerItem = CONTEXT_BANNER_THEME_ITEMS[mode];
  const bannerTiles = useThemedSymbols([bannerItem], symbolTheme, {
    batchSize: 1,
    singleSubject: true,
  });
  const bannerTile = themeTileFor(bannerTiles, bannerItem);
  const bannerStyle: CSSProperties | undefined = bannerTile
    ? {
      backgroundImage: `url(${JSON.stringify(bannerTile.imageUrl)})`,
      backgroundPosition: 'center 52%',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
    }
    : undefined;
  const dividerItem = CONTEXT_DIVIDER_THEME_ITEMS[mode];
  const dividerTiles = useThemedSymbols([dividerItem], symbolTheme, {
    batchSize: 1,
    singleSubject: true,
  });
  const dividerTile = themeTileFor(dividerTiles, dividerItem);
  const dividerStyle: CSSProperties | undefined = dividerTile
    ? {
      backgroundImage: `url(${JSON.stringify(dividerTile.imageUrl)})`,
      backgroundPosition: 'center 52%',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
    }
    : undefined;
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
            <div
              className={`context-row__empty${bannerTile ? ' context-row__empty--themed' : ''}`}
              style={bannerStyle}
            >
              <span className="context-row__spark" aria-hidden="true">
                <ThemedSymbol
                  symbol={CONTEXT_READY_THEME_ITEM.symbol}
                  tile={themeTileFor(readyTiles, CONTEXT_READY_THEME_ITEM)}
                />
              </span>
              <span className="context-row__message">
                {assistStatus === 'thinking'
                  ? `Preparing AI ${mode}…`
                  : `AI ${mode} will appear here after the next spoken turn.`}
              </span>
            </div>
          ) : generation === 'previous' && items.length === 0 && dividerTile ? (
            <div className="context-row__divider" style={dividerStyle} aria-hidden="true" />
          ) : generation === 'previous' && items.length === 0 ? (
            Array.from({ length: limit }, (_, index) => (
              <div
                className="context-cell context-cell--placeholder"
                aria-hidden="true"
                key={`empty-${mode}-${index}`}
              />
            ))
          ) : (
            items.slice(0, limit).map((suggestion, index) => {
              const faved = favorites.some((favorite) => favorite.text === suggestion.text);
              return (
                <div className="cellwrap context-cellwrap" key={`${suggestion.text}-${index}`}>
                  <button
                    type="button"
                    className={`cell context-cell${mode === 'phrases' ? ' cell--phrase' : ''}`}
                    title={suggestion.text}
                    onClick={() => {
                      if (mode === 'words') actions.appendComposition(suggestion.text);
                      else void session.speak(withoutSpokenEmoji(suggestion.text));
                    }}
                  >
                    <ThemedSymbol
                      symbol={suggestion.symbol}
                      tile={themeTileFor(tiles, suggestion)}
                    />
                    <span className="cell__word">{suggestion.text}</span>
                  </button>
                  <button
                    type="button"
                    className="cell__fav"
                    aria-pressed={faved}
                    aria-label={
                      faved
                        ? `Remove "${suggestion.text}" from Favs`
                        : `Keep "${suggestion.text}" in Favs`
                    }
                    title={faved ? 'Remove from Favs' : 'Keep in Favs'}
                    onClick={() => actions.toggleFavorite({
                      text: suggestion.text,
                      symbol: suggestion.symbol,
                      fitzgerald: 'social',
                    })}
                  >
                    {faved ? '★' : '☆'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}
