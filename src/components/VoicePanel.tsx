import type { JSX } from 'react';
import { session } from '@/session/AacSession';
import { CURATED_VOICES } from '@/speech/tts/curatedVoices';
import { actions, selectSettings, useStore, type AppState } from '@/state/store';

const selectSpeakers = (state: AppState) => state.speakers;
const selectTts = (state: AppState) => ({
  implementation: state.tts.implementation,
  status: state.tts.status,
});

/**
 * Everything about voices, in plain words: the voice this device speaks
 * with, and the voices it hears in the room. The measurement table lives on
 * the Checks page with the rest of the diagnostics.
 */
export function VoicePanel(): JSX.Element {
  const settings = useStore(selectSettings);
  const speakers = useStore(selectSpeakers);
  const tts = useStore(selectTts);
  const allVoices = session.tts.voices();
  const curatedAvailable = tts.implementation === 'sherpa-onnx' && allVoices.length > 100;

  // With nothing chosen yet the model speaks with its default voice (sid 0,
  // Ashley) - the list should say so rather than showing no selection.
  const chosenId = settings.voiceId ?? '0';

  // The Voice type setting narrows the shortlist. Neutral is its own
  // category - voices that don't land strongly male or female on the ear -
  // not a "show everything" escape hatch. Whatever the filter, the chosen
  // voice sorts to the top and is never hidden.
  const filtered = CURATED_VOICES.filter((voice) =>
    settings.voiceGender === 'neutral'
      ? voice.neutralSounding
      : voice.gender === settings.voiceGender,
  );
  const chosen = CURATED_VOICES.find((voice) => voice.id === chosenId);
  const shortlist = [
    ...(chosen ? [chosen] : []),
    ...filtered.filter((voice) => voice.id !== chosenId),
  ];

  return (
    <div className="panel voice-panel">
      <h2 className="panel__title">Your voice</h2>
      <p className="field__hint" style={{ marginBottom: '0.75rem' }}>
        {tts.implementation === 'sherpa-onnx'
          ? 'Press ▶ to hear a voice. Tap a name to make it your voice.'
          : 'These voices come from this device. On a call, your partner sees your words as text.'}
      </p>

      {curatedAvailable ? (
        <div className="voice-list" data-scan="">
          {shortlist.map((voice) => (
            <div className="voice-option" key={voice.id}>
              <button
                type="button"
                className="option voice-option__pick"
                aria-pressed={chosenId === voice.id}
                onClick={() => actions.setSettings({ voiceId: voice.id })}
              >
                <span className="voice-option__name">
                  {voice.name}
                  {chosenId === voice.id ? ' - your voice' : ''}
                </span>
                <span className="voice-option__meta">{voice.note}</span>
              </button>
              <button
                type="button"
                className="button voice-option__preview"
                title={`Hear ${voice.name}`}
                onClick={() => void session.previewVoice(voice.id)}
              >
                ▶
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="field">
          <label className="field__label" htmlFor="voice">
            Voice
          </label>
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

      <hr style={{ margin: '1.5rem 0', border: 0, borderTop: '1px solid var(--border)' }} />
      <h3 className="panel__title">Voices heard in the room</h3>
      <p className="field__hint" style={{ marginBottom: '0.75rem' }}>
        The device listens and learns each voice it hears. If a name is wrong, tap it and type a
        better one. If a voice is yours, press <strong>This is me</strong>.{' '}
        <strong>Forget</strong> makes the device forget that voice and learn it fresh.
      </p>

      {speakers.length === 0 ? (
        <p className="field__hint">No voices heard yet.</p>
      ) : (
        <ul className="speakers">
          {speakers.map((speaker) => (
            <li className="speaker" key={speaker.id}>
              <label className="visually-hidden" htmlFor={`speaker-${speaker.id}`}>
                Name for this voice
              </label>
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
