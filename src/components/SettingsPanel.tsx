import type { JSX } from 'react';
import { ThemedSymbol, themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import { session } from '@/session/AacSession';
import { actions, selectSettings, useStore, type SymbolTheme } from '@/state/store';

export const SETTINGS_THEME_ITEMS = [
  { text: 'What kind of voice? Male', symbol: '👨' },
  { text: 'What kind of voice? Female', symbol: '👩' },
  { text: 'What kind of voice? Neutral', symbol: '🧑' },
  { text: 'How fast should it talk? Slower', symbol: '🐢' },
  { text: 'How fast should it talk? Normal', symbol: '🚶' },
  { text: 'How fast should it talk? Faster', symbol: '🏃' },
  { text: 'How fast should it talk? Fastest', symbol: '⚡' },
  { text: 'How noisy is your room? Quiet', symbol: '🤫' },
  { text: 'How noisy is your room? Normal', symbol: '🏠' },
  { text: 'How noisy is your room? Noisy', symbol: '🗣️' },
  { text: 'How noisy is your room? Very noisy', symbol: '📢' },
  { text: 'Easier-to-see colours? On', symbol: '🌕' },
  { text: 'Easier-to-see colours? Off', symbol: '🌑' },
] as const;

const THEME_PREVIEW_ITEMS: Record<SymbolTheme, { text: string; symbol: string }> = {
  emoji: { text: 'Friendly picture-style preview', symbol: '🙂' },
  anime: { text: 'Friendly picture-style preview', symbol: '🎨' },
  'baby-shark': { text: 'Friendly picture-style preview', symbol: '🦈' },
  'hello-kitty': { text: 'Friendly picture-style preview', symbol: '🎀' },
};

/**
 * One setting, several big buttons.
 *
 * Every control in this panel is a row of large press-once choices — no
 * sliders to drag, no small checkboxes to hit. A slider assumes steady
 * sustained contact, which is exactly what many of this device's users do
 * not have; a labelled button states its meaning and takes one tap.
 *
 * The panel is deliberately short. Listening, dictation into the chat,
 * speak-on-tap, live text, symbols and the larger size are how the device
 * works, not options — a settings page full of ways to accidentally make
 * the device worse is a hazard, not a feature.
 */
function OptionRow<T>({
  label,
  hint,
  caution,
  value,
  options,
  symbolTheme,
  onChange,
}: {
  label: string;
  hint?: string;
  caution?: boolean;
  value: T;
  options: { label: string; value: T; hint?: string; symbol?: string }[];
  symbolTheme: SymbolTheme;
  onChange: (value: T) => void;
}): JSX.Element {
  const themeItems = options.map((option) => ({
    text: `${label} ${option.label}`,
    symbol: option.symbol ?? '',
  }));
  const themedSymbols = useThemedSymbols(themeItems, symbolTheme, {
    batchSize: Math.min(9, themeItems.length),
    singleSubject: true,
  });
  // Numeric presets highlight the nearest option, so a value persisted from
  // an older build still shows a selection instead of nothing.
  const selected =
    typeof value === 'number'
      ? options.reduce((best, option) =>
          Math.abs((option.value as number) - value) < Math.abs((best.value as number) - value)
            ? option
            : best,
        )
      : (options.find((option) => option.value === value) ?? null);

  return (
    <div className={`option-group${caution ? ' option-group--caution' : ''}`} role="group" aria-label={label}>
      <span className="field__label">{label}</span>
      <div className="option-row">
        {options.map((option, index) => (
          <button
            key={String(option.value)}
            type="button"
            className="option"
            aria-pressed={selected === option}
            title={option.hint}
            onClick={() => onChange(option.value)}
          >
            {option.symbol && (
              <span className="option__symbol" aria-hidden="true">
                <ThemedSymbol
                  symbol={option.symbol}
                  tile={themeTileFor(themedSymbols, themeItems[index]!)}
                />
              </span>
            )}
            {option.label}
          </button>
        ))}
      </div>
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}

function ThemePreview({ theme }: { theme: SymbolTheme }): JSX.Element {
  const item = THEME_PREVIEW_ITEMS[theme];
  const tiles = useThemedSymbols([item], theme, { batchSize: 1, singleSubject: true });
  return <ThemedSymbol symbol={item.symbol} tile={themeTileFor(tiles, item)} />;
}

function ThemeOptionRow({ value }: { value: SymbolTheme }): JSX.Element {
  const options: { label: string; value: SymbolTheme }[] = [
    { label: 'Emoji', value: 'emoji' },
    { label: 'Anime', value: 'anime' },
    { label: 'Baby Shark', value: 'baby-shark' },
    { label: 'Hello Kitty', value: 'hello-kitty' },
  ];
  return (
    <div className="option-group" role="group" aria-label="Button pictures">
      <span className="field__label">Button pictures</span>
      <div className="option-row option-row--theme-previews">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="option option--theme-preview"
            aria-pressed={value === option.value}
            onClick={() => actions.setSettings({ symbolTheme: option.value })}
          >
            <span className="option__symbol" aria-hidden="true">
              <ThemePreview theme={option.value} />
            </span>
            {option.label}
          </button>
        ))}
      </div>
      <p className="field__hint">
        Each button previews its own art style. Pictures are saved and reused; emoji remain as fallback.
      </p>
    </div>
  );
}

export function SettingsPanel({
  signedIn = false,
  symbolTheme,
}: {
  signedIn?: boolean;
  symbolTheme?: SymbolTheme;
}): JSX.Element {
  const settings = useStore(selectSettings);
  const displayedTheme = signedIn ? (symbolTheme ?? settings.symbolTheme) : 'emoji';

  return (
    <div className="panel settings-panel">
      <h2 className="panel__title">Settings</h2>

      {signedIn && <ThemeOptionRow value={settings.symbolTheme} />}

      <OptionRow
        label="What kind of voice?"
        hint="Then pick the exact voice on the 🎙️ Voice page."
        value={settings.voiceGender}
        symbolTheme={displayedTheme}
        options={[
          { label: 'Male', value: 'male' as const, symbol: '👨' },
          { label: 'Female', value: 'female' as const, symbol: '👩' },
          { label: 'Neutral', value: 'neutral' as const, symbol: '🧑' },
        ]}
        onChange={(voiceGender) => actions.setSettings({ voiceGender })}
      />

      <OptionRow
        label="How fast should it talk?"
        value={settings.speechRate}
        symbolTheme={displayedTheme}
        options={[
          { label: 'Slower', value: 0.75, symbol: '🐢' },
          { label: 'Normal', value: 1, symbol: '🚶' },
          { label: 'Faster', value: 1.25, symbol: '🏃' },
          { label: 'Fastest', value: 1.5, symbol: '⚡' },
        ]}
        onChange={(speechRate) => actions.setSettings({ speechRate })}
      />

      <OptionRow
        label="How noisy is your room?"
        hint="Pick the closest — it helps the device hear you instead of the room."
        value={settings.vadSensitivity}
        symbolTheme={displayedTheme}
        options={[
          { label: 'Quiet', value: 5, symbol: '🤫' },
          { label: 'Normal', value: 9, symbol: '🏠' },
          { label: 'Noisy', value: 14, symbol: '🗣️' },
          { label: 'Very noisy', value: 19, symbol: '📢' },
        ]}
        onChange={(vadSensitivity) => {
          actions.setSettings({ vadSensitivity });
          const provider = session.asr as { configureVad?: (options: { activationDb: number }) => void };
          provider.configureVad?.({ activationDb: vadSensitivity });
        }}
      />

      <OptionRow
        label="Easier-to-see colours?"
        hint="Everything turns yellow on black — much easier for some eyes."
        value={settings.highContrast}
        symbolTheme={displayedTheme}
        options={[
          { label: 'On', value: true, symbol: '🌕' },
          { label: 'Off', value: false, symbol: '🌑' },
        ]}
        onChange={(highContrast) => actions.setSettings({ highContrast })}
      />
    </div>
  );
}
