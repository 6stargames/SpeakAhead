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
      return undefined;
    }

    const finalTurns = input.turns.filter((turn) => turn.final).slice(-10);
    const latest = finalTurns.at(-1);
    if (!latest || processed.current.has(latest.id)) return undefined;
    processed.current.add(latest.id);

    const controller = new AbortController();
    const run = async () => {
      actions.setAssistStatus('thinking');
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
        for (const correction of response.corrections) {
          actions.applyContextCorrection(
            correction.turnId,
            correction.originalText,
            correction.correctedText,
            correction.reason,
            'chatgpt',
          );
        }
        actions.setContextSuggestions(response.words, response.phrases);
        actions.setAssistStatus('ready');
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
      for (const correction of corrections) {
        actions.applyContextCorrection(
          correction.id,
          correction.originalText,
          correction.correctedText,
          correction.reason,
          'on-device',
        );
      }
      actions.setContextSuggestions(
        localWordSuggestions(finalTurns),
        outcome.suggestions.slice(0, 3).map((text) => ({ text, symbol: symbolForText(text) })),
      );
      actions.setAssistStatus('local');
    };

    const timer = setTimeout(() => void run(), 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input.composition, input.enabled, input.turns, signedIn]);
}
