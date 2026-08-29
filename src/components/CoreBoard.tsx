import type { JSX } from 'react';
import type { FitzgeraldClass } from '@/lib/fitzgerald';
import { ThemedSymbol, themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import { actions, useStore, type AppState } from '@/state/store';

/**
 * The 36 Universal Core words (UNC Project Core).
 *
 * A handful of high-frequency, cross-contextual words generates more distinct
 * communicative intents than a hundred specific nouns, so this board is the
 * home screen. Every cell has a permanent coordinate: the grid never reflows,
 * never reorders, and masking a word hides it without moving its neighbours,
 * because the board is read with muscle memory as much as with the eyes.
 *
 * Colour follows the Modified Fitzgerald Key — the part of speech, not the
 * position, decides the colour, so a user scanning for "a verb" can filter the
 * whole board by hue.
 */
interface CoreWord {
  readonly word: string;
  readonly fitzgerald: FitzgeraldClass;
  /**
   * A stand-in transparent symbol. Production binds cells to the ARASAAC
   * symbol set (open-licensed); emoji keep the dual-modality layout honest
   * offline without shipping licensed artwork.
   */
  readonly symbol: string;
}

/** Column-ordered for left-to-right sentence building: who → does → how → where → ask. */
const CORE_WORDS: readonly (readonly CoreWord[])[] = [
  // Column 1 — pronouns (yellow)
  [
    { word: 'I', fitzgerald: 'pronoun', symbol: '🙋' },
    { word: 'you', fitzgerald: 'pronoun', symbol: '👉' },
    { word: 'he', fitzgerald: 'pronoun', symbol: '👨' },
    { word: 'she', fitzgerald: 'pronoun', symbol: '👩' },
    { word: 'it', fitzgerald: 'pronoun', symbol: '📦' },
    { word: 'they', fitzgerald: 'pronoun', symbol: '👥' },
  ],
  // Column 2 — verbs (green)
  [
    { word: 'want', fitzgerald: 'verb', symbol: '🤲' },
    { word: 'go', fitzgerald: 'verb', symbol: '➡️' },
    { word: 'stop', fitzgerald: 'verb', symbol: '✋' },
    { word: 'make', fitzgerald: 'verb', symbol: '🛠️' },
    { word: 'get', fitzgerald: 'verb', symbol: '🫴' },
    { word: 'put', fitzgerald: 'verb', symbol: '📥' },
  ],
  // Column 3 — verbs, and "not"
  [
    { word: 'look', fitzgerald: 'verb', symbol: '👀' },
    { word: 'turn', fitzgerald: 'verb', symbol: '🔄' },
    { word: 'do', fitzgerald: 'verb', symbol: '⚡' },
    { word: 'help', fitzgerald: 'verb', symbol: '🆘' },
    { word: 'open', fitzgerald: 'verb', symbol: '🔓' },
    { word: 'not', fitzgerald: 'descriptor', symbol: '🚫' },
  ],
  // Column 4 — descriptors (blue)
  [
    { word: 'good', fitzgerald: 'descriptor', symbol: '👍' },
    { word: 'bad', fitzgerald: 'descriptor', symbol: '👎' },
    { word: 'same', fitzgerald: 'descriptor', symbol: '🟰' },
    { word: 'different', fitzgerald: 'descriptor', symbol: '🔀' },
    { word: 'more', fitzgerald: 'descriptor', symbol: '➕' },
    { word: 'all', fitzgerald: 'descriptor', symbol: '♾️' },
  ],
  // Column 5 — prepositions and social (pink)
  [
    { word: 'in', fitzgerald: 'social', symbol: '⤵️' },
    { word: 'on', fitzgerald: 'social', symbol: '🔛' },
    { word: 'up', fitzgerald: 'social', symbol: '⬆️' },
    { word: 'down', fitzgerald: 'social', symbol: '⬇️' },
    { word: 'here', fitzgerald: 'social', symbol: '🎯' },
    { word: 'finished', fitzgerald: 'social', symbol: '✅' },
  ],
  // Column 6 — questions (purple)
  [
    { word: 'who', fitzgerald: 'question', symbol: '👤' },
    { word: 'what', fitzgerald: 'question', symbol: '❓' },
    { word: 'where', fitzgerald: 'question', symbol: '📍' },
    { word: 'when', fitzgerald: 'question', symbol: '🕐' },
    { word: 'why', fitzgerald: 'question', symbol: '❔' },
    { word: 'how', fitzgerald: 'question', symbol: '🤷' },
  ],
] as const;

const selectMasked = (state: AppState): string[] => state.maskedCoreWords;
const selectEditMode = (state: AppState): boolean => state.editMode;
const selectFavorites = (state: AppState) => state.favorites;

const CORE_THEME_ITEMS = Array.from({ length: 6 }, (_, row) =>
  CORE_WORDS.map((column) => column[row]).filter((cell): cell is CoreWord => Boolean(cell)),
).flat().map((cell) => ({ text: cell.word, symbol: cell.symbol }));

export function CoreBoard({ themedSymbolsEnabled = false }: { themedSymbolsEnabled?: boolean }): JSX.Element {
  const masked = useStore(selectMasked);
  const editMode = useStore(selectEditMode);
  const favorites = useStore(selectFavorites);
  const themedSymbols = useThemedSymbols(CORE_THEME_ITEMS, themedSymbolsEnabled);

  return (
    <section className="board card panel" aria-label="Core words">
      {/* Rendered row-major so switch scanning walks rows then columns, but
          authored column-major above so the sentence-building order is legible
          in the source. The DOM order is the scan order. */}
      <div className="board__grid board__grid--core" role="group" aria-label="Core word board" data-scan="grid">
        {Array.from({ length: 6 }, (_, row) =>
          CORE_WORDS.map((column, columnIndex) => {
            const cell = column[row];
            if (!cell) return null;
            const isMasked = masked.includes(cell.word);

            // Progressive masking: a hidden word keeps its coordinates. A
            // beginner's four-word board is this exact board with 32 cells
            // silent — nothing ever moves when a word is revealed.
            if (isMasked && !editMode) {
              return <div key={`${columnIndex}-${row}`} className="cell cell--empty" aria-hidden="true" />;
            }

            const faved = favorites.some((fav) => fav.text === cell.word);
            return (
              <div className="cellwrap" key={`${columnIndex}-${row}`}>
                <button
                  type="button"
                  className={`cell cell--${cell.fitzgerald}${isMasked ? ' cell--masked' : ''}${
                    editMode ? ' cell--editable' : ''
                  }`}
                  aria-pressed={editMode ? !isMasked : undefined}
                  title={editMode ? (isMasked ? 'Show this word' : 'Hide this word') : undefined}
                  onClick={() => {
                    if (editMode) actions.toggleCoreMask(cell.word);
                    else actions.appendComposition(cell.word);
                  }}
                >
                  <ThemedSymbol
                    symbol={cell.symbol}
                    tile={themeTileFor(themedSymbols, { text: cell.word, symbol: cell.symbol })}
                  />
                  <span className="cell__word">{cell.word}</span>
                </button>
                <button
                  type="button"
                  className="cell__fav"
                  aria-pressed={faved}
                  aria-label={faved ? `Remove "${cell.word}" from Favs` : `Keep "${cell.word}" in Favs`}
                  title={faved ? 'Remove from Favs' : 'Keep in Favs'}
                  onClick={() =>
                    actions.toggleFavorite({
                      text: cell.word,
                      symbol: cell.symbol,
                      fitzgerald: cell.fitzgerald,
                    })
                  }
                >
                  {faved ? '★' : '☆'}
                </button>
              </div>
            );
          }),
        )}
      </div>
    </section>
  );
}
