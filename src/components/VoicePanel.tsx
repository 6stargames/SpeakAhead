import type { CSSProperties, JSX } from 'react';
import { ThemedSymbol, themeTileFor, useThemedSymbols, type ThemeTile } from '@/assist/themeIcons';
import { session } from '@/session/AacSession';
import {
  VOICE_BADGE_THEME_ITEMS,
  VOICE_CHOICES,
  VOICE_PORTRAIT_THEME_ITEMS,
  isChatGptVoiceId,
} from '@/speech/tts/voiceChoices';
import { actions, selectSettings, useStore, type AppState } from '@/state/store';

const selectSpeakers = (state: AppState) => state.speakers;
const selectTts = (state: AppState) => ({
  implementation: state.tts.implementation,
  signedIn: state.accurateTranscriptionEnabled,
});

function backgroundStyle(tile: ThemeTile | undefined): CSSProperties | undefined {
  if (!tile) return undefined;
  const column = tile.index % tile.columns;
  const row = Math.floor(tile.index / tile.columns);
  const x = tile.columns <= 1 ? 0 : (column / (tile.columns - 1)) * 100;
  const y = tile.rows <= 1 ? 0 : (row / (tile.rows - 1)) * 100;
  return {
    backgroundImage: [
      'linear-gradient(90deg, color-mix(in srgb, var(--surface) 68%, transparent), color-mix(in srgb, var(--surface) 42%, transparent))',
      `url(${JSON.stringify(tile.imageUrl)})`,
    ].join(', '),
    backgroundPosition: `center, ${x}% ${y}%`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `cover, ${tile.columns * 100}% ${tile.rows * 100}%`,
  };
}

/** The selected speaking voice, plus the voices learned from the room. */
export function VoicePanel(): JSX.Element {
  const settings = useStore(selectSettings);
  const speakers = useStore(selectSpeakers);
  const tts = useStore(selectTts);
  const allVoices = session.tts.voices();
  const curatedAvailable = tts.implementation === 'sherpa-onnx' && allVoices.length > 100;
  const choices = tts.signedIn
    ? VOICE_CHOICES
    : VOICE_CHOICES.filter((voice) => voice.source === 'device');
  const chosenId = !tts.signedIn && isChatGptVoiceId(settings.voiceId)
    ? '0'
    : settings.voiceId ?? '0';
  const portraits = useThemedSymbols(VOICE_PORTRAIT_THEME_ITEMS, settings.symbolTheme, {
    batchSize: 3,
    singleSubject: true,
  });
  const backgrounds = useThemedSymbols(VOICE_BADGE_THEME_ITEMS, settings.symbolTheme, {
    batchSize: 1,
    singleSubject: true,
  });

  return (
    <div className="panel voice-panel">
      <h2 className="panel__title">Your voice</h2>
      <p className="field__hint voice-panel__hint">
        Tap a voice to hear it and make it your voice.
        {!tts.signedIn && ' Sign in with ChatGPT to add three natural ChatGPT voices.'}
      </p>

      {curatedAvailable ? (
        <div className="voice-list" data-scan="">
          {choices.map((voice) => {
            const index = VOICE_CHOICES.indexOf(voice);
            const portraitItem = VOICE_PORTRAIT_THEME_ITEMS[index]!;
            const backgroundItem = VOICE_BADGE_THEME_ITEMS[index]!;
            const portrait = themeTileFor(portraits, portraitItem);
            const background = themeTileFor(backgrounds, backgroundItem);
            return (
              <button
                type="button"
                className={`voice-option voice-option--${voice.source}${background ? ' voice-option--pictured' : ''}`}
                style={backgroundStyle(background)}
                key={voice.id}
                aria-pressed={chosenId === voice.id}
                aria-label={`${voice.name}, ${voice.source === 'chatgpt' ? 'ChatGPT voice' : 'device voice'}. ${chosenId === voice.id ? 'Your current voice.' : ''}`}
                onClick={() => {
                  actions.setSettings({ voiceId: voice.id });
                  void session.previewVoice(voice.id);
                }}
              >
                <span className="voice-option__portrait" aria-hidden="true">
                  <ThemedSymbol symbol={voice.symbol} tile={portrait} />
                </span>
                <span className="voice-option__copy">
                  <span className="voice-option__source">
                    {voice.source === 'chatgpt' ? 'ChatGPT' : 'Device'}
                  </span>
                  <span className="voice-option__name">{voice.name}</span>
                </span>
                {chosenId === voice.id && <span className="voice-option__selected">Your voice</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="field">
          <label className="field__label" htmlFor="voice">Voice</label>
          <select
            id="voice"
            value={settings.voiceId ?? ''}
            onChange={(event) => actions.setSettings({ voiceId: event.target.value })}
            disabled={allVoices.length === 0}
          >
            {allVoices.length === 0 && <option value="">No voices available</option>}
            {allVoices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name} {voice.language ? `(${voice.language})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <hr className="voice-panel__divider" />
      <h3 className="panel__title">Voices heard in the room</h3>
      <p className="field__hint voice-panel__hint">
        The device listens and learns each voice it hears. Tap a name to correct it, or mark your own voice.
      </p>

      {speakers.length === 0 ? (
        <p className="field__hint">No voices heard yet.</p>
      ) : (
        <ul className="speakers">
          {speakers.map((speaker) => (
            <li className="speaker" key={speaker.id}>
              <label className="visually-hidden" htmlFor={`speaker-${speaker.id}`}>Name for this voice</label>
              <input
                id={`speaker-${speaker.id}`}
                type="text"
                defaultValue={speaker.label}
                onBlur={(event) => session.renameSpeaker(speaker.id, event.target.value)}
              />
              <span className="speaker__meta">
                {speaker.utterances} {speaker.utterances === 1 ? 'turn' : 'turns'}
              </span>
              <button
                type="button"
                className="button"
                aria-pressed={speaker.isOwner}
                disabled={speaker.isOwner}
                onClick={() => session.markSpeakerAsOwner(speaker.id)}
                title="Words from this voice appear as yours"
              >
                {speaker.isOwner ? 'This is you' : 'This is me'}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => session.forgetSpeaker(speaker.id)}
                title="Forget this voice so it is learned again from scratch"
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
