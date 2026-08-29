import type { JSX } from 'react';
import { session } from '@/session/AacSession';
import {
  actions,
  selectContextualPhrases,
  selectContextualWords,
  selectPredictions,
  useStore,
  type AppState,
  type ContextSuggestion,
  type PredictionSourceId,
} from '@/state/store';
import { ThemedSymbol, themeTileFor, useThemedSymbols } from '@/assist/themeIcons';

const SOURCE_LABELS: Record<PredictionSourceId, string> = {
  'webmcp-agent': 'from the attached agent',
  'on-device-model': 'from the on-device model',
  heuristic: 'from on-device rules',
  none: '',
};

const selectStaged = (state: AppState): string | null => state.stagedSpeech;
const selectMicActive = (state: AppState): boolean => state.micActive;
const selectAsrReady = (state: AppState): boolean => state.asr.status === 'ready';
const selectMicError = (state: AppState): string | null => state.micError;
const selectMicPermission = (state: AppState) => state.micPermission;
const selectPredicting = (state: AppState): boolean => state.predicting;
const selectAssistStatus = (state: AppState): AppState['assistStatus'] => state.assistStatus;

/**
 * The quarantine surface for everything machine-suggested — staged agent
 * speech, reply predictions, microphone problems.
 *
 * It no longer owns a row of the layout: it floats over the board's corner
 * and renders nothing at all when there is nothing to show. The board never
 * moves either way — an overlay covers pixels, it does not displace them.
 * The air gap is unchanged: nothing here ever speaks on its own. Tapping a
 * suggestion speaks it — that is the user's deliberate act — and staged
 * agent speech still needs its explicit "Speak it" confirmation.
 */
export function SuggestionStrip({
  contextMode = null,
  themedSymbolsEnabled = false,
}: {
  contextMode?: 'words' | 'phrases' | null;
  themedSymbolsEnabled?: boolean;
}): JSX.Element | null {
  const staged = useStore(selectStaged);
  const micActive = useStore(selectMicActive);
  const asrReady = useStore(selectAsrReady);
  const micError = useStore(selectMicError);
  const micPermission = useStore(selectMicPermission);
  const predictions = useStore(selectPredictions);
  const predicting = useStore(selectPredicting);
  const contextualWords = useStore(selectContextualWords);
  const contextualPhrases = useStore(selectContextualPhrases);
  const assistStatus = useStore(selectAssistStatus);

  const contextual: ContextSuggestion[] =
    contextMode === 'words' ? contextualWords : contextMode === 'phrases' ? contextualPhrases : [];
  const themedSymbols = useThemedSymbols(contextual, themedSymbolsEnabled);

  const micProblem = !micActive && (micError !== null || (asrReady && micPermission === 'denied'));
  const source = predictions[0]?.source ?? 'none';

  if (
    staged === null &&
    !micProblem &&
    predictions.length === 0 &&
    contextual.length === 0 &&
    !predicting &&
    assistStatus !== 'thinking'
  ) return null;

  return (
    <div className="suggest-overlay card" aria-label="Suggestions" aria-live="polite" data-scan="">
      {staged !== null && (
        <div className="staged" role="group" aria-label="Message suggested by the agent">
          <span className="staged__label">An agent wrote this — you decide whether to say it</span>
          <p className="staged__text">{staged}</p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              void session.speak(staged);
              actions.stageSpeech(null);
            }}
          >
            Speak it
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              // The text moves into the buffer still carrying its authorship;
              // the marker clears the moment they actually edit it.
              actions.setComposition(staged, 'agent');
              actions.stageSpeech(null);
            }}
          >
            Edit first
          </button>
          <button type="button" className="button button--ghost" onClick={() => actions.stageSpeech(null)}>
            Discard
          </button>
        </div>
      )}

      {micProblem && (
        <div role="alert">
          <p className="suggest-overlay__error">
            {micError ?? 'This site is blocked from using the microphone.'}
          </p>
          {micPermission === 'denied' && (
            <p className="suggest-overlay__remedy">
              Click the icon at the left of the address bar, set <strong>Microphone</strong> to{' '}
              <strong>Allow</strong>, then reload this page. Dictation is the only feature that needs
              it — everything else keeps working without it.
            </p>
          )}
        </div>
      )}

      {predicting && <p className="suggest-overlay__label">Thinking…</p>}

      {assistStatus === 'thinking' && contextMode && (
        <p className="suggest-overlay__label">Preparing context choices…</p>
      )}

      {contextual.length > 0 && contextMode && (
        <>
          <p className="suggest-overlay__label">
            Context {contextMode}{assistStatus === 'local' ? ' · on-device fallback' : ' · with ChatGPT'}
          </p>
          <ul className="predictions" aria-label={`Context-aware ${contextMode}`}>
            {contextual.map((suggestion, index) => (
              <li key={`${suggestion.text}-${index}`}>
                <button
                  type="button"
                  className="button prediction prediction--symbol"
                  title={suggestion.text}
                  onClick={() => {
                    if (contextMode === 'words') actions.appendComposition(suggestion.text);
                    else void session.speak(suggestion.text);
                  }}
                >
                  <ThemedSymbol
                    symbol={suggestion.symbol}
                    tile={themeTileFor(themedSymbols, suggestion)}
                  />
                  <span>{suggestion.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {predictions.length > 0 && contextual.length === 0 && (
        <>
          <p className="suggest-overlay__label">
            Suggestions {SOURCE_LABELS[source]} · tap to speak immediately
          </p>
          <ul className="predictions" aria-label="Suggested replies">
            {predictions.map((prediction, index) => (
              <li key={`${prediction.text}-${index}`}>
                <button
                  type="button"
                  className="button prediction"
                  title={prediction.text}
                  onClick={() => {
                    // Tapping a suggestion is the fast path this whole feature
                    // exists for: one tap speaks it.
                    void session.speak(prediction.text);
                    actions.setPredictions([]);
                  }}
                >
                  {prediction.text}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
