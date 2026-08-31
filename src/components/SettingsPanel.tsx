import { useState, type JSX } from 'react';
import { ThemedSymbol, themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import {
  ALL_PICTURE_THEMES,
  MORE_PICTURE_THEMES,
  PRIMARY_PICTURE_THEMES,
  type PictureThemeOption,
} from '@/assist/pictureThemes';
import { session } from '@/session/AacSession';
import { isChatGptVoiceId, voiceChoicesForGender } from '@/speech/tts/voiceChoices';
import { actions, selectSettings, useStore, type SymbolTheme } from '@/state/store';

export const VOICE_GENDER_THEME_ITEMS = [
  { text: 'What kind of voice? Male', symbol: '👨' },
  { text: 'What kind of voice? Female', symbol: '👩' },
  { text: 'What kind of voice? Neutral', symbol: '🧑' },
] as const;

export const GENDER_AWARE_SETTINGS_THEME_ITEMS = [
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

export const SETTINGS_THEME_ITEMS = [
  ...VOICE_GENDER_THEME_ITEMS,
  ...GENDER_AWARE_SETTINGS_THEME_ITEMS,
] as const;

export const THEME_PREVIEW_ITEMS: Record<SymbolTheme, { text: string; symbol: string }> = {
  emoji: { text: 'Emoji art style preview', symbol: '🙂' },
  ghibli: { text: 'Ghibli art style preview', symbol: '🌤️' },
  'baby-shark': { text: 'Baby Shark art style preview', symbol: '🦈' },
  'hello-kitty': { text: 'Hello Kitty art style preview', symbol: '🎀' },
  claymation: { text: 'Claymation art style preview', symbol: '🟠' },
  'pixel-art': { text: 'Pixel art style preview', symbol: '👾' },
  'halo-3': { text: 'HALO 3 art style preview', symbol: '🛡️' },
  'stained-glass': { text: 'Stained glass art style preview', symbol: '💎' },
  'pop-art': { text: 'Pop art style preview', symbol: '💥' },
  cubism: { text: 'Cubism art style preview', symbol: '🖼️' },
  'ukiyo-e': { text: 'Ukiyo-e art style preview', symbol: '🌊' },
  papercraft: { text: 'Papercraft art style preview', symbol: '✂️' },
  'neon-cyberpunk': { text: 'Neon cyberpunk art style preview', symbol: '🌃' },
  'felted-wool': { text: 'Felted wool art style preview', symbol: '🧶' },
  'mid-century': { text: 'Mid-century art style preview', symbol: '🛋️' },
};

export const THEME_PREVIEW_PRELOADS = ALL_PICTURE_THEMES
  .filter((option): option is PictureThemeOption & { value: Exclude<SymbolTheme, 'emoji'> } => option.value !== 'emoji')
  .map((option) => ({ theme: option.value, item: THEME_PREVIEW_ITEMS[option.value] }));

const MORE_THEME_PICKER_OPTIONS: readonly PictureThemeOption[] = [
  PRIMARY_PICTURE_THEMES[0]!,
  ...MORE_PICTURE_THEMES,
];

/**
 * One setting, several big buttons.
 *
 * Every control in this panel is a row of large press-once choices - no
 * sliders to drag, no small checkboxes to hit. A slider assumes steady
 * sustained contact, which is exactly what many of this device's users do
 * not have; a labelled button states its meaning and takes one tap.
 *
 * The panel is deliberately short. Listening, dictation into the chat,
 * speak-on-tap, live text, symbols and the larger size are how the device
 * works, not options - a settings page full of ways to accidentally make
 * the device worse is a hazard, not a feature.
 */
function OptionRow<T>({
  label,
  hint,
  caution,
  value,
  options,
  symbolTheme,
  genderAware = true,
  onChange,
}: {
  label: string;
  hint?: string;
  caution?: boolean;
  value: T;
  options: { label: string; value: T; hint?: string; symbol?: string }[];
  symbolTheme: SymbolTheme;
  genderAware?: boolean;
  onChange: (value: T) => void;
}): JSX.Element {
  const themeItems = options.map((option) => ({
    text: `${label} ${option.label}`,
    symbol: option.symbol ?? '',
  }));
  const themedSymbols = useThemedSymbols(themeItems, symbolTheme, {
    batchSize: Math.min(9, themeItems.length),
    singleSubject: true,
    genderAware,
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
      <p className="field__heading">
        <span className="field__label">{label}</span>
        {hint && <span className="field__hint"> {hint}</span>}
      </p>
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
    </div>
  );
}

function ThemePreview({ theme }: { theme: SymbolTheme }): JSX.Element {
  const item = THEME_PREVIEW_ITEMS[theme];
  const tiles = useThemedSymbols([item], theme, {
    batchSize: 1,
    singleSubject: true,
    genderAware: false,
  });
  return <ThemedSymbol symbol={item.symbol} tile={themeTileFor(tiles, item)} />;
}

function ThemeOptionButton({ option, selected }: {
  option: PictureThemeOption;
  selected: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="option option--theme-preview"
      aria-label={option.label}
      aria-pressed={selected}
      onClick={() => actions.setSettings({ symbolTheme: option.value })}
    >
      <span className="option__symbol" aria-hidden="true">
        <ThemePreview theme={option.value} />
      </span>
      {option.label}
      {selected && <span className="option__selected-check" aria-hidden="true">✓</span>}
    </button>
  );
}

function ThemeOptionRow({ value, onViewMore }: {
  value: SymbolTheme;
  onViewMore: () => void;
}): JSX.Element {
  const selectedMoreTheme = MORE_PICTURE_THEMES.find((option) => option.value === value);
  const stackedTheme = selectedMoreTheme ?? PRIMARY_PICTURE_THEMES[0]!;

  return (
    <div className="option-group" role="group" aria-label="Button pictures">
      <p className="field__heading">
        <span className="field__label">Button pictures</span>
        <span className="field__hint"> Each button previews its own art style. Pictures are saved and reused.</span>
      </p>
      <div className="option-row option-row--theme-previews">
        <div className="theme-option-stack">
          <ThemeOptionButton option={stackedTheme} selected={value === stackedTheme.value} />
          <button
            type="button"
            className="option theme-option-stack__more"
            aria-haspopup="dialog"
            onClick={onViewMore}
          >
            View more
          </button>
        </div>
        {PRIMARY_PICTURE_THEMES.slice(1).map((option) => (
          <ThemeOptionButton key={option.value} option={option} selected={value === option.value} />
        ))}
      </div>
    </div>
  );
}

function MoreThemesPanel({ value, onDone }: {
  value: SymbolTheme;
  onDone: () => void;
}): JSX.Element {
  return (
    <section className="theme-more" role="dialog" aria-modal="true" aria-labelledby="theme-more-title">
      <div className="theme-more__scroll">
        <div className="theme-more__header">
          <h2 id="theme-more-title">More button pictures</h2>
          <p>Choose a style. Pictures are saved and reused.</p>
        </div>
        <div className="theme-more__grid" data-scan="grid">
          {MORE_THEME_PICKER_OPTIONS.map((option) => (
            <ThemeOptionButton key={option.value} option={option} selected={value === option.value} />
          ))}
        </div>
      </div>
      <button type="button" className="button button--primary theme-more__done" onClick={onDone}>
        DONE
      </button>
    </section>
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
  const [showMoreThemes, setShowMoreThemes] = useState(false);
  const displayedTheme = signedIn ? (symbolTheme ?? settings.symbolTheme) : 'emoji';

  if (signedIn && showMoreThemes) {
    return (
      <div className="panel settings-panel settings-panel--theme-picker">
        <MoreThemesPanel value={settings.symbolTheme} onDone={() => setShowMoreThemes(false)} />
      </div>
    );
  }

  return (
    <div className="panel settings-panel">
      {signedIn && (
        <ThemeOptionRow value={settings.symbolTheme} onViewMore={() => setShowMoreThemes(true)} />
      )}

      <OptionRow
        label="What kind of voice?"
        hint="Then pick the exact voice on the 🎙️ Voice page."
        value={settings.voiceGender}
        symbolTheme={displayedTheme}
        genderAware={false}
        options={[
          { label: 'Male', value: 'male' as const, symbol: '👨' },
          { label: 'Female', value: 'female' as const, symbol: '👩' },
          { label: 'Neutral', value: 'neutral' as const, symbol: '🧑' },
        ]}
        onChange={(voiceGender) => {
          const choices = voiceChoicesForGender(voiceGender, signedIn);
          const currentVoiceIsVisible = choices.some((voice) => voice.id === settings.voiceId);
          const currentSource = isChatGptVoiceId(settings.voiceId) ? 'chatgpt' : 'device';
          const nextVoiceId = currentVoiceIsVisible
            ? settings.voiceId
            : (choices.find((voice) => voice.source === currentSource) ?? choices[0])?.id;
          actions.setSettings({
            voiceGender,
            ...(nextVoiceId ? { voiceId: nextVoiceId } : {}),
          });
        }}
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
        hint="Pick the closest. it helps the device hear you instead of the room."
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
        hint="Everything turns yellow on black. much easier for some eyes."
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
