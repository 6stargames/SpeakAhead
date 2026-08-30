import { useEffect, useRef } from 'react';
import { predictionEngine } from '@/prediction/PredictionEngine';
import { actions, store, useStore, type AppState, type Turn } from '@/state/store';
import type { SpeakerProfile } from '@/speech/speakers';
import { requestContextAssist } from './client';
import { filterNovelChoices } from './choiceAvailability';
import { localContextCorrection, localWordSuggestions, symbolForText } from './fallback';

const selectAssistInput = (state: AppState) => ({
  turns: state.turns,
  composition: state.composition,
  speakers: state.speakers,
});

/**
 * A live recogniser updates its unfinished turn many times a second. Those
 * updates must not restart the context debounce: only a newly finished,
 * attributable conversation turn creates new language work.
 */
export function contextAssistRequestKey(
  turns: readonly (Pick<Turn, 'id' | 'final'> & Partial<Pick<
    Turn,
    'source' | 'dictated' | 'speakerId' | 'voice'
  >>)[],
  _composition = '',
): string | null {
  const latestFinal = turns.findLast((turn) => turn.final);
  if (!latestFinal) return null;
  // Deliberately spoken/tapped AAC output is the user's reply, never a reason
  // to propose another reply. Locally dictated speech waits for attribution so
  // we do not mistake the owner's voice for somebody else in the room.
  if (latestFinal.source === 'user' && !latestFinal.dictated) return null;
  if (
    latestFinal.source === 'user' &&
    latestFinal.dictated &&
    !latestFinal.speakerId &&
    !latestFinal.voice
  ) return null;
  return `${latestFinal.id}\u0000${latestFinal.speakerId ?? ''}`;
}

export function isOtherSpeakerTurn(
  turn: Pick<Turn, 'source' | 'dictated' | 'speakerId'>,
  speakers: readonly SpeakerProfile[],
): boolean {
  if (turn.source === 'peer') return true;
  if (!turn.dictated || !turn.speakerId) return false;
  const speaker = speakers.find((candidate) => candidate.id === turn.speakerId);
  return Boolean(speaker && !speaker.isOwner);
}

function isOwnerTurn(
  turn: Pick<Turn, 'source' | 'dictated' | 'speakerId'>,
  speakers: readonly SpeakerProfile[],
): boolean {
  if (turn.source !== 'user') return false;
  if (!turn.dictated) return true;
  if (!turn.speakerId) return false;
  return Boolean(speakers.find((candidate) => candidate.id === turn.speakerId)?.isOwner);
}

interface ContextAssistJob {
  readonly key: string;
  readonly finalTurns: Turn[];
  readonly composition: string;
  /** New turns from people other than the AAC user, combined into one reply batch. */
  readonly replyTurns: Turn[];
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
export const REPLY_BATCH_SETTLE_MS = 1_800;
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
  let correctionTaskId: string | undefined;
  let suggestionTaskId: string | undefined;
  const finishTasks = (
    status: 'idle' | 'ready' | 'local' | 'unavailable' | 'error',
    correctionCount = 0,
    suggestionCount = 0,
  ) => {
    if (!tasksOpen) return;
    tasksOpen = false;
    actions.finishAssistTask('corrections', status, correctionCount, correctionTaskId);
    if (suggestionTaskId) {
      actions.finishAssistTask('suggestions', status, suggestionCount, suggestionTaskId);
    }
  };

  actions.setAssistStatus('thinking');
  const contextText = (job.finalTurns.at(-1)?.text || 'the recent conversation')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  correctionTaskId = actions.beginAssistTask('corrections', `Checking “${contextText}”`);
  if (job.replyTurns.length > 0) {
    const replyContext = job.replyTurns
      .map((turn) => `“${turn.text.replace(/\s+/g, ' ').trim()}”`)
      .join(' + ')
      .slice(0, 180);
    suggestionTaskId = actions.beginAssistTask(
      'suggestions',
      `Preparing 6 words + 4 phrases from ${replyContext}`,
    );
  }
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
        generateSuggestions: job.replyTurns.length > 0,
        excludedWords: requestExclusions.words,
        excludedPhrases: requestExclusions.phrases,
      },
      signal,
    );
    if (signal.aborted) return;

    if (response) {
      actions.recordAssistUsage('text', response.usage);
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
      if (job.replyTurns.length > 0) {
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
      }
      const visibleState = store.getState();
      const visibleSuggestionCount = job.replyTurns.length > 0
        ? visibleState.contextualWords.length + visibleState.contextualPhrases.length
        : 0;
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
    const outcome = job.replyTurns.length > 0
      ? await predictionEngine.predict(context)
      : { suggestions: [] };
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
    if (job.replyTurns.length > 0) {
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
    }
    const visibleState = store.getState();
    const visibleSuggestionCount = job.replyTurns.length > 0
      ? visibleState.contextualWords.length + visibleState.contextualPhrases.length
      : 0;
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
  const handledReplyTurns = useRef(new Set<string>());
  const requestKey = contextAssistRequestKey(input.turns, input.composition);

  // Coalesce a stream of new finished turns into one latest pending snapshot.
  // Updating this ref never interrupts work that is already in flight.
  useEffect(() => {
    if (!signedIn || !requestKey) {
      latestJob.current = null;
      observedKey.current = null;
      return;
    }
    if (observedKey.current === requestKey) return;
    observedKey.current = requestKey;
    const finalTurns = input.turns.filter((turn) => turn.final).slice(-10);
    const lastOwnerIndex = finalTurns.findLastIndex((turn) => isOwnerTurn(turn, input.speakers));
    const replyTurns = finalTurns.slice(lastOwnerIndex + 1).filter(
      (turn) => isOtherSpeakerTurn(turn, input.speakers) && !handledReplyTurns.current.has(turn.id),
    );
    latestJob.current = {
      key: requestKey,
      finalTurns,
      composition: input.composition,
      replyTurns,
      queuedAt: Date.now(),
    };
  }, [input.composition, input.speakers, input.turns, requestKey, signedIn]);

  // One durable worker drains the latest snapshot. New transcript turns never
  // abort an OpenAI request; they replace only the not-yet-started pending job.
  useEffect(() => {
    if (!signedIn) {
      processedKey.current = null;
      handledReplyTurns.current.clear();
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
      const settleMs = job.replyTurns.length > 0 ? REPLY_BATCH_SETTLE_MS : CONTEXT_SETTLE_MS;
      const wait = Math.max(job.queuedAt + settleMs - now, nextAllowedAt - now);
      if (wait > 0) {
        schedule(Math.min(wait, CONTEXT_QUEUE_POLL_MS));
        return;
      }

      processedKey.current = job.key;
      job.replyTurns.forEach((turn) => handledReplyTurns.current.add(turn.id));
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
  }, [signedIn]);
}
