import { useCallback, useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';
import { themeTileBackgroundStyle, themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import { session } from '@/session/AacSession';
import { voiceBadgeThemeItem, voiceChoicesForGender } from '@/speech/tts/voiceChoices';
import { actions, selectComposition, selectCompositionAuthor, useStore, type AppState } from '@/state/store';

const selectSpeaking = (state: AppState): boolean => state.speaking;
const selectLastSpoken = (state: AppState): string | null => state.lastSpokenText;
const selectVoicePresentation = (state: AppState) => ({
  voiceId: state.settings.voiceId,
  voiceGender: state.settings.voiceGender,
  symbolTheme: state.settings.symbolTheme,
});

/**
 * The output ribbon: the utterance under construction and the button that says
 * it, persistent across every view.
 *
 * This is the topmost interactive band of the screen because it is the point
 * of the whole device - the boards below exist to fill it, and the transcript
 * exists to inform it. Nothing above or beside it competes for the Speak
 * action, and it never moves, whatever view is open underneath.
 */
export function OutputRibbon({ leading }: { leading?: ReactNode } = {}): JSX.Element {
  const composition = useStore(selectComposition);
  const compositionAuthor = useStore(selectCompositionAuthor);
  const speaking = useStore(selectSpeaking);
  const lastSpoken = useStore(selectLastSpoken);
  const voicePresentation = useStore(selectVoicePresentation);
  const selectedVoice = voiceChoicesForGender(voicePresentation.voiceGender)
    .find((voice) => voice.id === voicePresentation.voiceId);
  const voiceBadgeItem = selectedVoice ? voiceBadgeThemeItem(selectedVoice) : null;
  const voiceBadgeTiles = useThemedSymbols(
    voiceBadgeItem ? [voiceBadgeItem] : [],
    voicePresentation.symbolTheme,
    { batchSize: 1, singleSubject: true },
  );
  const voiceBadgeTile = voiceBadgeItem
    ? themeTileFor(voiceBadgeTiles, voiceBadgeItem)
    : undefined;

  const inputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The app's name lives here briefly on load - the old title bar is gone,
  // and the message box is the one place every eye starts.
  const [placeholder, setPlaceholder] = useState(
    'Context-Aware Augmentative & Alternative Communication',
  );
  useEffect(() => {
    const timer = window.setTimeout(() => setPlaceholder('Tap words below, or type here…'), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  const handleChange = useCallback((value: string) => {
    actions.setComposition(value);
    session.sendComposingUpdate(value);
  }, []);

  const handleSpeak = useCallback(() => {
    void session.speakComposition();
    textareaRef.current?.focus();
  }, []);

  const agentAuthored = composition.length > 0 && compositionAuthor === 'agent';

  return (
    <section className="ribbon" id="compose" aria-labelledby={`${inputId}-label`}>
      <h2 className="visually-hidden" id={`${inputId}-label`}>
        Your message
      </h2>

      {leading}

      <div className="ribbon__message">
        {agentAuthored && (
          <p className="composer__origin" id={`${inputId}-origin`}>
            The assistant wrote this - check it says what you mean before speaking.
          </p>
        )}
        <label className="visually-hidden" htmlFor={inputId}>
          Message to speak
        </label>
        {/*
          The declarative WebMCP surface marks agent-filled forms natively with
          `SubmitEvent.agentInvoked` and `:tool-form-active`; our tools are
          imperative, so the same guarantee is made here by hand. The one thing
          that must never happen silently is agent-written words leaving in the
          user's voice, so the buffer says who wrote it until the user edits it.
        */}
        <textarea
          id={inputId}
          ref={textareaRef}
          className={`ribbon__input${agentAuthored ? ' composer__input--agent' : ''}`}
          aria-describedby={agentAuthored ? `${inputId}-origin` : undefined}
          value={composition}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck
          rows={1}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter speaks; Shift+Enter inserts a newline. Speed matters more
            // than multi-line composition on a device someone talks with.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSpeak();
            }
          }}
        />
      </div>

      <div className="ribbon__actions" data-scan="">
        <button
          type="button"
          className={`button button--primary button--speak${
            voiceBadgeTile ? ' button--speak-pictured' : ''
          }`}
          style={themeTileBackgroundStyle(voiceBadgeTile)}
          onClick={handleSpeak}
          disabled={composition.trim().length === 0 || speaking}
        >
          {speaking ? 'Speaking…' : 'Speak'}
        </button>

        {speaking && (
          <button type="button" className="button button--danger" onClick={() => session.stopSpeaking()}>
            Stop
          </button>
        )}

        {/*
          The repair primitive, beside Speak and as prominent as Clear. A
          tremor's double-tap costs exactly one press per stray word - never
          the whole sentence. (Task 01 of the round-two brief.)
        */}
        <button
          type="button"
          className="button"
          onClick={() => {
            const next = actions.deleteLastWord();
            session.sendComposingUpdate(next);
            textareaRef.current?.focus();
          }}
          disabled={composition.trim().length === 0}
          title="Remove the last word only"
        >
          ⌫ Word
        </button>

        <button
          type="button"
          className="button"
          onClick={() => {
            actions.clearComposition();
            // Tell the partner the half-typed message is gone.
            session.sendComposingUpdate('');
            textareaRef.current?.focus();
          }}
          disabled={composition.length === 0}
        >
          Clear
        </button>

        {/* Repeat the previous message in one press. It stays out of the
            composition buffer, so there is no second Speak step. */}
        {composition.length === 0 && lastSpoken !== null && !speaking && (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              void session.speak(lastSpoken);
              textareaRef.current?.focus();
            }}
            title="Send and speak the last message again"
          >
            Again
          </button>
        )}

      </div>
    </section>
  );
}
