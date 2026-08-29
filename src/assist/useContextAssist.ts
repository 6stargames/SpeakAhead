import { useEffect, useRef } from 'react';
import { predictionEngine } from '@/prediction/PredictionEngine';
import { actions, useStore, type AppState } from '@/state/store';
import { requestContextAssist } from './client';
import { localContextCorrection, localWordSuggestions, symbolForText } from './fallback';

const selectAssistInput = (state: AppState) => ({
  turns: state.turns,
  composition: state.composition,
  enabled: state.settings.chatGPTAssist,
});

/**
 * Text-only signed-in assistance. This hook observes finished turns, never
 * audio frames. If the cloud route is unavailable, the existing local
 * prediction ladder and a conservative context matcher take over.
 */
export function useContextAssist(signedIn: boolean): void {
  const input = useStore(selectAssistInput);
  const processed = useRef(new Set<string>());

  useEffect(() => {
    if (!signedIn || !input.enabled) {
      processed.current.clear();
      actions.setAssistStatus('idle');
      actions.setContextSuggestions([], []);
      actions.setAssistFeatureStatus('corrections', 'idle');
      actions.setAssistFeatureStatus('suggestions', 'idle');
      return undefined;
    }

    const finalTurns = input.turns.filter((turn) => turn.final).slice(-10);
    const latest = finalTurns.at(-1);
    if (!latest || processed.current.has(latest.id)) return undefined;
    processed.current.add(latest.id);

    const controller = new AbortController();
    let tasksOpen = false;
    const finishTasks = (
      status: 'idle' | 'ready' | 'local' | 'unavailable' | 'error',
      correctionCount = 0,
      suggestionCount = 0,
    ) => {
      if (!tasksOpen) return;
      tasksOpen = false;
      actions.finishAssistTask('corrections', status, correctionCount);
      actions.finishAssistTask('suggestions', status, suggestionCount);
    };
    const run = async () => {
      actions.setAssistStatus('thinking');
      actions.beginAssistTask('corrections');
      actions.beginAssistTask('suggestions');
      tasksOpen = true;
      try {
        const response = await requestContextAssist(
          {
            turns: finalTurns.map((turn) => ({
              id: turn.id,
              source: turn.source,
              text: turn.text,
              dictated: turn.dictated,
              ...(turn.words ? { words: turn.words } : {}),
            })),
            composition: input.composition,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;

        if (response) {
          let applied = 0;
          for (const correction of response.corrections) {
            if (
              actions.applyContextCorrection(
                correction.turnId,
                correction.originalText,
                correction.correctedText,
                correction.reason,
                'chatgpt',
              )
            ) applied += 1;
          }
          actions.setContextSuggestions(response.words, response.phrases);
          actions.setAssistStatus('ready');
          finishTasks('ready', applied, response.words.length + response.phrases.length);
          return;
        }

        // The private, zero-dependency fallback is intentionally useful rather
        // than an error state: assistance gets better with the cloud connection,
        // but communication never depends on it.
        const correctionCandidates = finalTurns.filter(
          (turn) => turn.dictated && turn.words && !turn.originalText,
        );
        const corrections: {
          id: string;
          originalText: string;
          correctedText: string;
          reason: string;
        }[] = [];
        for (const candidate of correctionCandidates.slice(-2)) {
          const prior = finalTurns.filter((turn) => turn.id !== candidate.id);
          const correction = localContextCorrection(candidate, prior);
          if (correction) {
            corrections.push({ id: candidate.id, originalText: candidate.text, ...correction });
          }
        }

        const context = {
          turns: finalTurns.map((turn) => ({
            source: turn.source,
            text: turn.text,
          })),
          composition: input.composition,
        };
        const outcome = await predictionEngine.predict(context);
        if (controller.signal.aborted) return;
        let applied = 0;
        for (const correction of corrections) {
          if (
            actions.applyContextCorrection(
              correction.id,
              correction.originalText,
              correction.correctedText,
              correction.reason,
              'on-device',
            )
          ) applied += 1;
        }
        const words = localWordSuggestions(finalTurns);
        const phrases = outcome.suggestions
          .slice(0, 3)
          .map((text) => ({ text, symbol: symbolForText(text) }));
        actions.setContextSuggestions(words, phrases);
        actions.setAssistStatus('local');
        finishTasks('local', applied, words.length + phrases.length);
      } catch {
        if (!controller.signal.aborted) {
          actions.setAssistStatus('error');
          finishTasks('error');
        }
      } finally {
        if (tasksOpen) finishTasks(controller.signal.aborted ? 'idle' : 'error');
      }
    };

    const timer = setTimeout(() => void run(), 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
      finishTasks('idle');
    };
  }, [input.composition, input.enabled, input.turns, signedIn]);
}
