import type { JSX } from 'react';
import {
  ThemedSymbol,
  themeTileBackgroundStyle,
  themeTileFor,
  useThemedSymbols,
} from '@/assist/themeIcons';
import { session } from '@/session/AacSession';
import {
  isChatGptVoiceId,
  voiceBadgeThemeItem,
  voiceChoicesForGender,
  voicePortraitThemeItem,
} from '@/speech/tts/voiceChoices';
import { actions, selectSettings, useStore, type AppState } from '@/state/store';

const selectSpeakers = (state: AppState) => state.speakers;
const selectTts = (state: AppState) => ({
  implementation: state.tts.implementation,
  status: state.tts.status,
  signedIn: state.accurateTranscriptionEnabled,
});

/** The selected speaking voice, plus the voices learned from the room. */
export function VoicePanel(): JSX.Element {
  const settings = useStore(selectSettings);
  const speakers = useStore(selectSpeakers);
  const tts = useStore(selectTts);
  const choices = voiceChoicesForGender(settings.voiceGender, tts.signedIn);
  const portraitItems = choices.map(voicePortraitThemeItem);
  const backgroundItems = choices.map(voiceBadgeThemeItem);
  const chosenId = !tts.signedIn && isChatGptVoiceId(settings.voiceId)
    ? null
    : settings.voiceId;
  const portraits = useThemedSymbols(portraitItems, settings.symbolTheme, {
    batchSize: 3,
    singleSubject: true,
  });
  const backgrounds = useThemedSymbols(backgroundItems, settings.symbolTheme, {
    batchSize: 1,
    singleSubject: true,
  });

  return (
    <div className="panel voice-panel">
      <h2 className="panel__title">Your voice</h2>
      <p className="field__hint voice-panel__hint">
        Showing {settings.voiceGender} voices. Tap one to hear it and make it your voice.
        {!tts.signedIn && ' Sign in with ChatGPT to add three OpenAI voices for each voice type.'}
      </p>

      {tts.implementation === 'web-speech' && (
        <p className="field__hint voice-panel__engine-note" role="status">
          The ONNX device voices are unavailable right now. OpenAI voices can still be selected.
        </p>
      )}

      <div className="voice-list" data-scan="" data-voice-gender={settings.voiceGender}>
        {choices.map((voice, index) => {
          const portraitItem = portraitItems[index]!;
          const backgroundItem = backgroundItems[index]!;
          const portrait = themeTileFor(portraits, portraitItem);
          const background = themeTileFor(backgrounds, backgroundItem);
          const unavailable = voice.source === 'device' && (
            tts.implementation === 'web-speech' || tts.status === 'unavailable' || tts.status === 'error'
          );
          return (
            <button
              type="button"
              className={`voice-option voice-option--${voice.source}${background ? ' voice-option--pictured' : ''}`}
              style={themeTileBackgroundStyle(background)}
              key={`${voice.gender}:${voice.id}`}
              aria-pressed={chosenId === voice.id}
              aria-label={`${voice.name}, ${voice.source === 'chatgpt' ? 'OpenAI voice' : 'device voice'}. ${chosenId === voice.id ? 'Your current voice.' : ''}`}
              disabled={unavailable}
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
                  {voice.source === 'chatgpt' ? 'OpenAI' : 'Device'}
                </span>
                <span className="voice-option__name">{voice.name}</span>
              </span>
              {chosenId === voice.id && <span className="voice-option__selected">Your voice</span>}
            </button>
          );
        })}
      </div>

      <hr className="voice-panel__divider" />
      <h3 className="panel__title">Voices heard in the room</h3>
      <p className="field__hint voice-panel__hint">
        The device listens and learns each voice it hears. Tap a name to correct it.
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
