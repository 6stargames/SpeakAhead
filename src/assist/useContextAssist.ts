import { useEffect, useRef } from 'react';
import { predictionEngine } from '@/prediction/PredictionEngine';
import { actions, store, useStore, type AppState, type Turn } from '@/state/store';
import { requestContextAssist } from './client';
import { filterNovelChoices } from './choiceAvailability';
import { localContextCorrection, localWordSuggestions, symbolForText } from './fallback';

const selectAssistInput = (state: AppState) => ({
  turns: state.turns,
  composition: state.composition,
  enabled: state.settings.chatGPTAssist,
});

/**
 * A live recogniser updates its unfinished turn many times a second. Those
 * updates must not restart the context debounce: only a newly finished turn
 * or a changed composition creates new language work.
 */
export function contextAssistRequestKey(
  turns: readonly Pick<Turn, 'id' | 'final'>[],
  composition: string,
): string | null {
  const latestFinal = turns.findLast((turn) => turn.final);
  return latestFinal ? `${latestFinal.id}\u0000${composition}` : null;
}

interface ContextAssistJob {
  readonly key: string;
  readonly finalTurns: Turn[];
  readonly composition: string;
  readonly queuedAt: number;
}

function completeChoices<T extends { text: string }>(
  primary: readonly T[],
  fallback: readonly T[],
  count: number,
  mode: 'words' | 'phrases',
  unavailable: readonly string[],
): T[] {
  return filterNovelChoices([...primary, ...fallback], mode, unavailable, count);
}

const SAFE_PHRASE_FALLBACKS = [
  { text: 'I agree.', symbol: '✅' },
  { text: 'Not now, please.', symbol: '🚫' },
  { text: 'Tell me more.', symbol: '💬' },
  { text: 'What happens next?', symbol: '❓' },
] as const;

function contextChoiceExclusions(state: Pick<
  AppState,
  | 'favorites'
  | 'contextualWords'
  | 'contextualPhrases'
  | 'previousContextualWords'
  | 'previousContextualPhrases'
>): { words: string[]; phrases: string[] } {
  const favorites = state.favorites.map((favorite) => favorite.text);
  return {
    words: [
      ...favorites,
      ...state.contextualWords.map((choice) => choice.text),
      ...state.previousContextualWords.map((choice) => choice.text),
    ],
    phrases: [
      ...favorites,
      ...state.contextualPhrases.map((choice) => choice.text),
      ...state.previousContextualPhrases.map((choice) => choice.text),
    ],
  };
}

const CONTEXT_SETTLE_MS = 250;
const CONTEXT_MIN_START_INTERVAL_MS = 5_000;
const CONTEXT_QUEUE_POLL_MS = 250;
export const THEMED_CONTEXT_HOLD_MS = 30_000;

/**
 * Emoji is instant, but generated pictures need a stable target. The current
 * themed generation stays put for a short window while correction checks keep
 * running normally in the background.
 */
export function contextChoicesReadyForRefresh(
  state: Pick<AppState, 'contextualWords' | 'contextualPhrases' | 'contextSuggestionsUpdatedAt' | 'settings'>,
  now = Date.now(),
): boolean {
  if (state.contextualWords.length === 0 && state.contextualPhrases.length === 0) return true;
  if (state.settings.symbolTheme === 'emoji') return true;
  return now - state.contextSuggestionsUpdatedAt >= THEMED_CONTEXT_HOLD_MS;
}

async function runContextJob(job: ContextAssistJob, signal: AbortSignal): Promise<void> {
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

  actions.setAssistStatus('thinking');
  actions.beginAssistTask('corrections');
  actions.beginAssistTask('suggestions');
  tasksOpen = true;

  try {
    const requestExclusions = contextChoiceExclusions(store.getState());
    const response = await requestContextAssist(
      {
        turns: job.finalTurns.map((turn) => ({
          id: turn.id,
          source: turn.source,
          text: turn.text,
          dictated: turn.dictated,
          ...(turn.words ? { words: turn.words } : {}),
        })),
        composition: job.composition,
        excludedWords: requestExclusions.words,
        excludedPhrases: requestExclusions.phrases,
      },
      signal,
    );
    if (signal.aborted) return;

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
      const currentExclusions = contextChoiceExclusions(store.getState());
      const words = completeChoices(
        response.words,
        localWordSuggestions(job.finalTurns),
        6,
        'words',
        currentExclusions.words,
      );
      const phrases = completeChoices(
        response.phrases,
        SAFE_PHRASE_FALLBACKS,
        4,
        'phrases',
        currentExclusions.phrases,
      );
      const refreshChoices = contextChoicesReadyForRefresh(store.getState());
      if (refreshChoices) actions.setContextSuggestions(words, phrases);
      const visibleState = store.getState();
      const visibleSuggestionCount =
        visibleState.contextualWords.length + visibleState.contextualPhrases.length;
      actions.setAssistStatus('ready');
      finishTasks('ready', applied, visibleSuggestionCount);
      return;
    }

    // The private, zero-dependency fallback is intentionally useful rather
    // than an error state: assistance gets better with the cloud connection,
    // but communication never depends on it.
    const correctionCandidates = job.finalTurns.filter(
      (turn) => turn.dictated && turn.words && !turn.originalText,
    );
    const corrections: {
      id: string;
      originalText: string;
      correctedText: string;
      reason: string;
    }[] = [];
    for (const candidate of correctionCandidates.slice(-2)) {
      const prior = job.finalTurns.filter((turn) => turn.id !== candidate.id);
      const correction = localContextCorrection(candidate, prior);
      if (correction) {
        corrections.push({ id: candidate.id, originalText: candidate.text, ...correction });
      }
    }

    const context = {
      turns: job.finalTurns.map((turn) => ({
        source: turn.source,
        text: turn.text,
      })),
      composition: job.composition,
    };
    const outcome = await predictionEngine.predict(context);
    if (signal.aborted) return;
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
    const currentExclusions = contextChoiceExclusions(store.getState());
    const words = completeChoices(
      localWordSuggestions(job.finalTurns),
      [],
      6,
      'words',
      currentExclusions.words,
    );
    const phrases = completeChoices(
      outcome.suggestions.map((text) => ({ text, symbol: symbolForText(text) })),
      SAFE_PHRASE_FALLBACKS,
      4,
      'phrases',
      currentExclusions.phrases,
    );
    const refreshChoices = contextChoicesReadyForRefresh(store.getState());
    if (refreshChoices) actions.setContextSuggestions(words, phrases);
    const visibleState = store.getState();
    const visibleSuggestionCount =
      visibleState.contextualWords.length + visibleState.contextualPhrases.length;
    actions.setAssistStatus('local');
    finishTasks('local', applied, visibleSuggestionCount);
  } catch {
    if (!signal.aborted) {
      actions.setAssistStatus('error');
      finishTasks('error');
    }
  } finally {
    if (tasksOpen) finishTasks(signal.aborted ? 'idle' : 'error');
  }
}

/**
 * Text-only signed-in assistance. This hook observes finished turns, never
 * audio frames. If the cloud route is unavailable, the existing local
 * prediction ladder and a conservative context matcher take over.
 */
export function useContextAssist(signedIn: boolean): void {
  const input = useStore(selectAssistInput);
  const latestJob = useRef<ContextAssistJob | null>(null);
  const observedKey = useRef<string | null>(null);
  const processedKey = useRef<string | null>(null);
  const requestKey = contextAssistRequestKey(input.turns, input.composition);

  // Coalesce a stream of new finished turns into one latest pending snapshot.
  // Updating this ref never interrupts work that is already in flight.
  useEffect(() => {
    if (!signedIn || !input.enabled || !requestKey) {
      latestJob.current = null;
      observedKey.current = null;
      return;
    }
    if (observedKey.current === requestKey) return;
    observedKey.current = requestKey;
    latestJob.current = {
      key: requestKey,
      finalTurns: input.turns.filter((turn) => turn.final).slice(-10),
      composition: input.composition,
      queuedAt: Date.now(),
    };
  }, [input.composition, input.enabled, input.turns, requestKey, signedIn]);

  // One durable worker drains the latest snapshot. New transcript turns never
  // abort an OpenAI request; they replace only the not-yet-started pending job.
  useEffect(() => {
    if (!signedIn || !input.enabled) {
      processedKey.current = null;
      actions.setAssistStatus('idle');
      actions.setContextSuggestions([], []);
      actions.setAssistFeatureStatus('corrections', 'idle');
      actions.setAssistFeatureStatus('suggestions', 'idle');
      return undefined;
    }

    const controller = new AbortController();
    let stopped = false;
    let running = false;
    let nextAllowedAt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delay = CONTEXT_QUEUE_POLL_MS) => {
      if (stopped) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(tick, delay);
    };

    const tick = () => {
      timer = null;
      if (stopped || running) return;
      const job = latestJob.current;
      if (!job || processedKey.current === job.key) {
        schedule();
        return;
      }

      const now = Date.now();
      const wait = Math.max(job.queuedAt + CONTEXT_SETTLE_MS - now, nextAllowedAt - now);
      if (wait > 0) {
        schedule(Math.min(wait, CONTEXT_QUEUE_POLL_MS));
        return;
      }

      processedKey.current = job.key;
      nextAllowedAt = now + CONTEXT_MIN_START_INTERVAL_MS;
      running = true;
      void runContextJob(job, controller.signal).finally(() => {
        running = false;
        schedule(0);
      });
    };

    schedule(0);
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      controller.abort();
    };
  }, [input.enabled, signedIn]);
}
