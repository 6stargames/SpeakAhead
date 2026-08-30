import type { JSX } from 'react';
import { ThemedSymbol, themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import type { SymbolTheme } from '@/state/store';

export const CLOSE_CHAT_THEME_ITEM = {
  text: 'Close back to chat',
  symbol: '↩️',
} as const;

/** A pinned return control whose edge decoration follows the picture theme. */
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

  return (
    <button
      type="button"
      className="button button--primary assist-tasks__close themed-close"
      onClick={onClose}
    >
      <span className="themed-close__edge" aria-hidden="true">
        <ThemedSymbol symbol={CLOSE_CHAT_THEME_ITEM.symbol} tile={tile} />
      </span>
      <span className="themed-close__label">Close — back to chat</span>
      <span className="themed-close__edge themed-close__edge--end" aria-hidden="true">
        <ThemedSymbol symbol={CLOSE_CHAT_THEME_ITEM.symbol} tile={tile} />
      </span>
    </button>
  );
}
