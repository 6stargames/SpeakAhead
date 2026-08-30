import type { CSSProperties, JSX } from 'react';
import { themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import type { SymbolTheme } from '@/state/store';

export const CLOSE_CHAT_THEME_ITEM = {
  text: 'Close back to chat',
  symbol: '↩️',
  presentation: 'button-background',
} as const;

/** A pinned return control whose full background follows the picture theme. */
export function ThemedCloseButton({
  onClose,
  symbolTheme = 'emoji',
}: {
  onClose: () => void;
  symbolTheme?: SymbolTheme;
}): JSX.Element {
  const tiles = useThemedSymbols([CLOSE_CHAT_THEME_ITEM], symbolTheme, {
    batchSize: 1,
    singleSubject: true,
  });
  const tile = themeTileFor(tiles, CLOSE_CHAT_THEME_ITEM);
  const style: CSSProperties | undefined = tile
    ? {
      backgroundImage: `url(${JSON.stringify(tile.imageUrl)})`,
      backgroundPosition: 'center 52%',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
    }
    : undefined;

  return (
    <button
      type="button"
      className={`button button--primary assist-tasks__close themed-close${
        tile ? ' themed-close--pictured' : ''
      }`}
      onClick={onClose}
      style={style}
    >
      <span className="themed-close__label">Close - back to chat</span>
    </button>
  );
}
