import type { JSX } from 'react';
import { session } from '@/session/AacSession';
import { actions, useStore, type AppState, type FavItem } from '@/state/store';

const selectFavorites = (state: AppState): FavItem[] => state.favorites;

/**
 * Favs: the words and phrases this user starred, on one flat board.
 *
 * There are no folders and no editor — every card on the word and phrase
 * boards carries a small star, and starring it puts it here. Tapping a fav
 * speaks it; tapping its star lets it go again.
 */
export function FringeBoard(): JSX.Element {
  const favorites = useStore(selectFavorites);

  return (
    <section className="board card panel" aria-label="Favs">
      {favorites.length === 0 ? (
        <p className="board__empty">
          Nothing saved yet. Tap the little <span aria-hidden="true">☆</span> star on any word or
          phrase to keep it here.
        </p>
      ) : (
        <div className="board__grid board__grid--favs" role="group" aria-label="Favourites" data-scan="grid">
          {favorites.map((item) => (
            <div className="cellwrap" key={item.text}>
              <button
                type="button"
                className={`cell cell--phrase cell--${item.fitzgerald}`}
                onClick={() => {
                  // A saved word speaks on the tap — that is what it is for.
                  void session.speak(item.text);
                }}
              >
                {item.symbol && (
                  <span className="cell__symbol" aria-hidden="true">
                    {item.symbol}
                  </span>
                )}
                <span className="cell__word">{item.text}</span>
              </button>
              <button
                type="button"
                className="cell__fav"
                aria-pressed="true"
                aria-label={`Remove "${item.text}" from Favs`}
                title="Remove from Favs"
                onClick={() => actions.toggleFavorite(item)}
              >
                ★
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
