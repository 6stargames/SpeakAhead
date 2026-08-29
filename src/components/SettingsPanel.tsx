import type { JSX } from 'react';
import { session } from '@/session/AacSession';
import { actions, selectSettings, useStore } from '@/state/store';

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
  onChange,
}: {
  label: string;
  hint?: string;
  caution?: boolean;
  value: T;
  options: { label: string; value: T; hint?: string; symbol?: string }[];
  onChange: (value: T) => void;
}): JSX.Element {
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
        {options.map((option) => (
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
                {option.symbol}
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

export function SettingsPanel({ signedIn = false }: { signedIn?: boolean }): JSX.Element {
  const settings = useStore(selectSettings);

  return (
    <div className="panel settings-panel">
      <h2 className="panel__title">Settings</h2>

      {signedIn && (
        <OptionRow
          label="ChatGPT context help?"
          hint="Uses the recent chat text to repair uncertain words and prepare quick replies. Microphone audio never leaves this device."
          value={settings.chatGPTAssist}
          options={[
            { label: 'On', value: true, symbol: '✨' },
            { label: 'Off', value: false, symbol: '🔒' },
          ]}
          onChange={(chatGPTAssist) => actions.setSettings({ chatGPTAssist })}
        />
      )}

      {signedIn && (
        <OptionRow
          label="Button pictures"
          hint="Anime pictures are generated once, stored on this device, and reused. Emoji always remain as a fallback."
          value={settings.symbolTheme}
          options={[
            { label: 'Emoji', value: 'emoji' as const, symbol: '🙂' },
            { label: 'Anime', value: 'anime' as const, symbol: '🎨' },
          ]}
          onChange={(symbolTheme) => actions.setSettings({ symbolTheme })}
        />
      )}

      <OptionRow
        label="What kind of voice?"
        hint="Then pick the exact voice on the 🎙️ Voice page."
        value={settings.voiceGender}
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
        options={[
          { label: 'On', value: true, symbol: '🌕' },
          { label: 'Off', value: false, symbol: '🌑' },
        ]}
        onChange={(highContrast) => actions.setSettings({ highContrast })}
      />
    </div>
  );
}
