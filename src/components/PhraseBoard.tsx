import type { JSX } from 'react';
import { session } from '@/session/AacSession';
import { actions, useStore, type AppState, type SymbolTheme } from '@/state/store';
import type { FitzgeraldClass } from '@/lib/fitzgerald';
import { ThemedSymbol, themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import { ContextSuggestionRow } from '@/components/ContextSuggestionRow';

interface Phrase {
  readonly text: string;
  /** Stand-in transparent symbol; production binds ARASAAC imagery. */
  readonly symbol: string;
}

/**
 * Fringe vocabulary: whole phrases, one tap deep, never more.
 *
 * The groups below no longer render as tabs — everything is on one board —
 * but each still lends its phrases a fixed colour from the Modified
 * Fitzgerald Key, so the board can be scanned by hue as well as read.
 *
 * These are the utterances where latency does real harm — the ones a person
 * needs before they need anything else. They are one tap from anywhere in the
 * interface, and they never depend on a model, a network, or an agent.
 */
const CATEGORIES: readonly {
  readonly id: string;
  readonly label: string;
  readonly fitzgerald: FitzgeraldClass;
  readonly phrases: readonly Phrase[];
}[] = [
  {
    id: 'urgent',
    label: 'Urgent',
    fitzgerald: 'emergency',
    phrases: [
      { text: 'I need help right now.', symbol: '🆘' },
      { text: 'I am in pain.', symbol: '🤕' },
      { text: 'I cannot breathe well.', symbol: '🫁' },
      { text: 'Please call a nurse.', symbol: '🧑‍⚕️' },
      { text: 'Please call my family.', symbol: '👪' },
      { text: 'Something is wrong.', symbol: '⚠️' },
      { text: 'Please stop.', symbol: '✋' },
      { text: 'I need the bathroom.', symbol: '🚻' },
    ],
  },
  {
    id: 'needs',
    label: 'Needs',
    fitzgerald: 'noun',
    phrases: [
      { text: 'I would like some water, please.', symbol: '💧' },
      { text: 'I am hungry.', symbol: '🍽️' },
      { text: 'I am cold.', symbol: '🥶' },
      { text: 'I am hot.', symbol: '🥵' },
      { text: 'I am tired.', symbol: '😴' },
      { text: 'I would like to sit up.', symbol: '🪑' },
      { text: 'I would like to lie down.', symbol: '🛏️' },
      { text: 'Could you adjust my pillow?', symbol: '🛋️' },
    ],
  },
  {
    id: 'social',
    label: 'Social',
    fitzgerald: 'social',
    phrases: [
      { text: 'Hello, good to see you.', symbol: '👋' },
      { text: 'Thank you very much.', symbol: '🙏' },
      { text: 'Yes, please.', symbol: '✅' },
      { text: 'No, thank you.', symbol: '❌' },
      { text: 'Please wait a moment.', symbol: '⏳' },
      { text: 'Could you repeat that?', symbol: '🔁' },
      { text: 'I am listening.', symbol: '👂' },
      { text: 'Goodbye for now.', symbol: '✌️' },
    ],
  },
  {
    id: 'conversation',
    label: 'Talking',
    fitzgerald: 'descriptor',
    phrases: [
      { text: 'Please slow down a little.', symbol: '🐢' },
      { text: 'I need more time to answer.', symbol: '⏱️' },
      { text: 'Let me finish, please.', symbol: '☝️' },
      { text: 'I did not understand that.', symbol: '❓' },
      { text: 'That is right.', symbol: '✔️' },
      { text: 'That is not what I meant.', symbol: '↩️' },
      { text: 'Can we talk about this later?', symbol: '🕰️' },
      { text: 'I have something to say.', symbol: '💬' },
    ],
  },
] as const;

/**
 * One flat board, no tabs: every phrase is one tap deep, and the Fitzgerald
 * colour it inherits from its group keeps the grid scannable by hue —
 * urgent red first, then needs, social, and conversation-repair.
 */
const ALL_PHRASES = CATEGORIES.flatMap((category) =>
  category.phrases.map((phrase) => ({ ...phrase, fitzgerald: category.fitzgerald })),
);

const selectFavorites = (state: AppState) => state.favorites;
const PHRASE_THEME_ITEMS = ALL_PHRASES.map(({ text, symbol }) => ({ text, symbol }));

export function PhraseBoard({
  contextAssistEnabled = false,
  symbolTheme = 'emoji',
}: {
  contextAssistEnabled?: boolean;
  symbolTheme?: SymbolTheme;
}): JSX.Element {
  const favorites = useStore(selectFavorites);
  const themedSymbols = useThemedSymbols(PHRASE_THEME_ITEMS, symbolTheme);

  return (
    <section className="board card panel" aria-label="Phrases">
      <ContextSuggestionRow
        mode="phrases"
        enabled={contextAssistEnabled}
        symbolTheme={symbolTheme}
      />
      <div className="board__grid board__grid--phrases" role="group" aria-label="Phrases" data-scan="grid">
        {ALL_PHRASES.map((phrase) => {
          const faved = favorites.some((fav) => fav.text === phrase.text);
          return (
            <div className="cellwrap" key={phrase.text}>
              <button
                type="button"
                className={`cell cell--phrase cell--${phrase.fitzgerald}`}
                onClick={() => {
                  // A phrase always speaks on the tap: it exists to be said.
                  void session.speak(phrase.text);
                }}
              >
                <ThemedSymbol
                  symbol={phrase.symbol}
                  tile={themeTileFor(themedSymbols, phrase)}
                />
                <span className="cell__word">{phrase.text}</span>
              </button>
              <button
                type="button"
                className="cell__fav"
                aria-pressed={faved}
                aria-label={faved ? `Remove "${phrase.text}" from Favs` : `Keep "${phrase.text}" in Favs`}
                title={faved ? 'Remove from Favs' : 'Keep in Favs'}
                onClick={() =>
                  actions.toggleFavorite({
                    text: phrase.text,
                    symbol: phrase.symbol,
                    fitzgerald: phrase.fitzgerald,
                  })
                }
              >
                {faved ? '★' : '☆'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
