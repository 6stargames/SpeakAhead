import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { EngineInfo } from '@/speech/types';
import type { CallState } from '@/webrtc/PeerSession';
import type { SignalingStatus } from '@/webrtc/SignalingClient';
import type { ComplianceResult } from '@/audio/routing';
import type { AudioGraphState } from '@/audio/AudioGraph';
import { createId } from '@/lib/id';
import type { FitzgeraldClass } from '@/lib/fitzgerald';
import type { AttributionAttempt, SpeakerProfile } from '@/speech/speakers';
import { filterNovelChoices } from '@/assist/choiceAvailability';

export type TurnSource = 'user' | 'peer';

export interface Turn {
  readonly id: string;
  readonly source: TurnSource;
  readonly text: string;
  readonly final: boolean;
  readonly at: number;
  /** True once this turn has been synthesised and broadcast. */
  readonly spoken: boolean;
  /** True when the text arrived over the data channel rather than from ASR. */
  readonly viaRtt: boolean;
  /** Which voice in the room said it, when that could be determined. */
  readonly speakerId?: string;
  /**
   * What the voice separator measured for this utterance.
   *
   * Attached to the turn rather than kept in a diagnostics panel: the question
   * "why was this one not recognised?" is asked about a specific bubble, and
   * the answer belongs next to it.
   */
  readonly voice?: { pitchHz: number | null; frames: number; considered: number; reason: string };
  /** Recognised from the microphone rather than typed, and not spoken aloud. */
  readonly dictated: boolean;
  /** Per-word decoder confidence, for marking words that may be misheard. */
  readonly words?: readonly { text: string; confidence: number }[];
  /** The recogniser's text before a contextual correction was applied. */
  readonly originalText?: string;
  /** Why the contextual checker changed this turn, shown beside the undo. */
  readonly correctionReason?: string;
  /** Which assistant supplied the correction. */
  readonly correctionSource?: 'chatgpt' | 'on-device';
}

export type PredictionSourceId = 'webmcp-agent' | 'on-device-model' | 'heuristic' | 'none';

export interface Prediction {
  readonly text: string;
  readonly source: PredictionSourceId;
}

/**
 * Deliberately small. This device always listens, always dictates into the
 * chat, always speaks phrases on tap, always sends text as it is typed,
 * always shows symbols beside words at the larger size, never sends audio
 * to the cloud, and an agent's speech always waits for a confirming tap —
 * none of that is configurable, so none of it is here.
 */
export interface Settings {
  speechRate: number;
  voiceId: string | null;
  /**
   * Which curated voices the Voice page offers: male only, female only, or no
   * preference. A shortlist filter only — it never changes the chosen voice.
   */
  voiceGender: 'male' | 'female' | 'neutral';
  vadSensitivity: number;
  highContrast: boolean;
  /** Device-local visual preference for symbols on vocabulary cards. */
  symbolTheme: SymbolTheme;
}

export type SymbolTheme = 'emoji' | 'anime' | 'baby-shark' | 'hello-kitty';

export interface ContextSuggestion {
  readonly text: string;
  /** Immediate fallback while a themed image is loading or unavailable. */
  readonly symbol: string;
}

export type AssistFeature = 'corrections' | 'suggestions' | 'themes';
export type AssistFeatureStatus =
  | 'idle'
  | 'working'
  | 'ready'
  | 'local'
  | 'unavailable'
  | 'error';

export interface AssistTaskEntry {
  readonly id: string;
  /** Plain-language description of the actual text or pictures being handled. */
  readonly label: string;
  readonly status: AssistFeatureStatus;
  readonly resultCount: number;
  readonly startedAt: number;
  readonly finishedAt: number | null;
}

export interface AssistFeatureActivity {
  /** Work currently in flight. This is the number shown beside the user. */
  readonly activeTasks: number;
  /** Last durable outcome, retained after the active count returns to zero. */
  readonly status: AssistFeatureStatus;
  /** Corrections, choices, or pictures produced by the most recent pass. */
  readonly resultCount: number;
  /** Newest work first; active and completed work share this one bounded list. */
  readonly tasks: readonly AssistTaskEntry[];
}

export interface AssistUsage {
  /** When this in-browser SpeakAhead usage window began. */
  readonly startedAt: number;
  readonly textRequests: number;
  readonly imageRequests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

/**
 * One favourited word or phrase. Favs are collected in place: every card on
 * the word and phrase boards carries a small star, and starring it puts it
 * here — no folders, no editor, no caregiver mode.
 */
export interface FavItem {
  readonly text: string;
  /** Optional symbol (emoji stand-in until ARASAAC binding lands). */
  readonly symbol: string;
  readonly fitzgerald: FitzgeraldClass;
}

/** Who wrote the exact text currently in the composition buffer. */
export type CompositionAuthor = 'user' | 'agent';

export interface AppState {
  readonly turns: Turn[];
  readonly composition: string;
  /**
   * 'agent' when the buffer holds text the user has not yet read — an agent
   * wrote it there, or an expansion rewrote what they typed. The composer
   * marks such text until the user edits or clears it, mirroring what the
   * declarative WebMCP surface does natively with `SubmitEvent.agentInvoked`:
   * nobody should tap Speak believing machine-written words are their own.
   * Choosing visible text — a prediction chip, a phrase-board entry — counts
   * as the user's, because they read it before it entered the buffer.
   */
  readonly compositionAuthor: CompositionAuthor;
  /**
   * What the recogniser is hearing right now, before it commits.
   *
   * Dictation without live feedback is unusable: with nothing on screen until
   * the utterance ends, there is no way to tell whether the microphone is being
   * heard at all, and the natural response is to stop and start again.
   */
  readonly dictationPreview: string;
  /** Agent-authored text awaiting the user's confirmation. */
  readonly stagedSpeech: string | null;
  /**
   * The last utterance spoken from the buffer, kept so an accidental Speak is
   * recoverable: the words cannot be unsaid, but the sentence can be restored
   * for correction instead of being rebuilt from nothing.
   */
  readonly lastSpokenText: string | null;
  /**
   * Caregiver editing mode. While true, boards edit instead of speak, and the
   * whole frame is visibly marked so nobody mistakes editing for talking.
   */
  readonly editMode: boolean;
  /** Starred words and phrases, in the order they were starred. */
  readonly favorites: FavItem[];
  /**
   * Core words currently masked (hidden in place). Progressive masking: the
   * grid is complete from day one and words are revealed, never moved.
   */
  readonly maskedCoreWords: string[];
  readonly predictions: Prediction[];
  readonly predicting: boolean;
  readonly contextualWords: ContextSuggestion[];
  readonly contextualPhrases: ContextSuggestion[];
  /** The displaced generation remains visible in the second AI row. */
  readonly previousContextualWords: ContextSuggestion[];
  readonly previousContextualPhrases: ContextSuggestion[];
  /** Used to keep themed choices still long enough for their pictures to finish. */
  readonly contextSuggestionsUpdatedAt: number;
  readonly assistStatus: 'idle' | 'thinking' | 'ready' | 'local' | 'unavailable' | 'error';
  readonly assistFeatures: Record<AssistFeature, AssistFeatureActivity>;
  /** Real API usage returned to this page; never account-wide ChatGPT usage. */
  readonly assistUsage: AssistUsage;

  readonly asr: EngineInfo;
  readonly tts: EngineInfo;
  /**
   * The speaker-verification network's state. Surfaced because its absence is
   * invisible in the transcript: attribution silently falls back to the
   * pitch-and-timbre heuristics, and the only trace is "timbre" rather than
   * "voiceprint" in the diagnostics reasons.
   */
  readonly speakerModel: { status: 'idle' | 'loading' | 'ready' | 'error'; detail: string };

  readonly audio: AudioGraphState | null;
  readonly compliance: ComplianceResult[];
  /** Voices heard in the room, distinguished by pitch. */
  readonly speakers: SpeakerProfile[];
  /** Voices forming in the nursery — heard, not yet assigned a speaker. */
  readonly pendingVoices: number;
  /** Recent attribution attempts, for diagnosing voices that go unidentified. */
  readonly voiceAttempts: AttributionAttempt[];
  /** Who is speaking right now, guessed while they are still talking. */
  readonly liveSpeaker: { id: string; label: string; isOwner: boolean } | null;
  readonly micActive: boolean;
  /** Browser permission state, so the interface can say *why* the mic is off. */
  readonly micPermission: 'granted' | 'denied' | 'prompt' | 'unknown';
  /** Last microphone failure, shown inline rather than only as a toast. */
  readonly micError: string | null;
  readonly speaking: boolean;
  readonly emergencyOverride: boolean;

  readonly call: CallState;
  readonly signaling: SignalingStatus;
  readonly roomCode: string;
  /** Whether this device created the room (host) or joined a typed code. */
  readonly callHost: boolean;
  readonly rttReady: boolean;
  readonly peerName: string | null;
  readonly peerEmergency: boolean;

  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBufferAvailable: boolean;
  readonly hardwareConcurrency: number;
  readonly webMcpAvailable: boolean;
  readonly online: boolean;

  readonly settings: Settings;
  readonly notices: { id: string; level: 'info' | 'warning' | 'error'; text: string }[];
}

/** The spec's rolling window: the agent sees the last ten turns. */
export const CONTEXT_WINDOW = 10;
const MAX_TURNS = 250;
const MAX_NOTICES = 6;
const MAX_ASSIST_TASKS = 30;
let assistTaskSequence = 0;

const idleEngine: EngineInfo = { status: 'idle', implementation: 'none', offline: true };

const initialState: AppState = {
  turns: [],
  composition: '',
  compositionAuthor: 'user',
  dictationPreview: '',
  stagedSpeech: null,
  lastSpokenText: null,
  editMode: false,
  favorites: [],
  maskedCoreWords: [],
  predictions: [],
  predicting: false,
  contextualWords: [],
  contextualPhrases: [],
  previousContextualWords: [],
  previousContextualPhrases: [],
  contextSuggestionsUpdatedAt: 0,
  assistStatus: 'idle',
  assistFeatures: {
    corrections: { activeTasks: 0, status: 'idle', resultCount: 0, tasks: [] },
    suggestions: { activeTasks: 0, status: 'idle', resultCount: 0, tasks: [] },
    themes: { activeTasks: 0, status: 'idle', resultCount: 0, tasks: [] },
  },
  assistUsage: {
    startedAt: Date.now(),
    textRequests: 0,
    imageRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  },

  asr: idleEngine,
  tts: idleEngine,
  speakerModel: { status: 'idle', detail: 'Not started.' },

  audio: null,
  compliance: [],
  speakers: [],
  pendingVoices: 0,
  voiceAttempts: [],
  liveSpeaker: null,
  micActive: false,
  micPermission: 'unknown',
  micError: null,
  speaking: false,
  emergencyOverride: false,

  call: 'idle',
  signaling: 'idle',
  roomCode: '',
  callHost: false,
  rttReady: false,
  peerName: null,
  peerEmergency: false,

  crossOriginIsolated: false,
  sharedArrayBufferAvailable: false,
  hardwareConcurrency: 1,
  webMcpAvailable: false,
  online: true,

  settings: {
    speechRate: 1,
    voiceId: null,
    voiceGender: 'neutral',
    vadSensitivity: 9,
    highContrast: false,
    symbolTheme: 'emoji',
  },
  notices: [],
};

type Listener = () => void;

class Store {
  #state: AppState = initialState;
  #listeners = new Set<Listener>();

  getState = (): AppState => this.#state;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  set = (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)): void => {
    const next = typeof patch === 'function' ? patch(this.#state) : patch;
    let changed = false;
    for (const key of Object.keys(next) as (keyof AppState)[]) {
      if (!Object.is(this.#state[key], next[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.#state = { ...this.#state, ...next };
    for (const listener of [...this.#listeners]) listener();
  };

  reset = (): void => {
    this.#state = {
      ...initialState,
      assistUsage: { ...initialState.assistUsage, startedAt: Date.now() },
    };
    for (const listener of [...this.#listeners]) listener();
  };
}

export const store = new Store();

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'aac.settings.v1';
const VOCAB_KEY = 'aac.vocab.v1';

function persistVocab(): void {
  const { favorites, maskedCoreWords } = store.getState();
  try {
    localStorage.setItem(VOCAB_KEY, JSON.stringify({ favorites, masked: maskedCoreWords }));
  } catch {
    /* Private browsing or blocked storage: vocabulary is best-effort. */
  }
}

export const actions = {
  setComposition(text: string, author: CompositionAuthor = 'user'): void {
    // An empty buffer has no author worth flagging.
    store.set({ composition: text, compositionAuthor: text.length === 0 ? 'user' : author });
  },

  setDictationPreview(text: string): void {
    store.set({ dictationPreview: text });
  },

  appendComposition(fragment: string): void {
    const current = store.getState().composition;
    const needsSpace = current.length > 0 && !/\s$/.test(current) && !/^[\s.,!?;:]/.test(fragment);
    // Appending is a user gesture, and the result is theirs.
    store.set({ composition: `${current}${needsSpace ? ' ' : ''}${fragment}`, compositionAuthor: 'user' });
  },

  clearComposition(): void {
    store.set({ composition: '', compositionAuthor: 'user', stagedSpeech: null, dictationPreview: '' });
  },

  /**
   * Remove the last word from the buffer.
   *
   * The repair primitive. A tremor that double-taps a cell must be fixable in
   * as many selections as it took to make the error — never by clearing the
   * whole utterance and rebuilding it from nothing.
   */
  deleteLastWord(): string {
    const next = store.getState().composition.replace(/\s*\S+\s*$/, '');
    store.set({ composition: next, compositionAuthor: 'user' });
    return next;
  },

  setLastSpoken(text: string | null): void {
    store.set({ lastSpokenText: text });
  },

  setEditMode(editMode: boolean): void {
    store.set({ editMode });
  },

  /** Star or unstar a word or phrase. Identity is the text itself. */
  toggleFavorite(item: FavItem): void {
    const favorites = store.getState().favorites;
    const exists = favorites.some((fav) => fav.text === item.text);
    store.set({
      favorites: exists ? favorites.filter((fav) => fav.text !== item.text) : [...favorites, item],
    });
    persistVocab();
  },

  /** Mask or unmask a core word in place. The grid itself never changes. */
  toggleCoreMask(word: string): void {
    const masked = store.getState().maskedCoreWords;
    store.set({
      maskedCoreWords: masked.includes(word) ? masked.filter((w) => w !== word) : [...masked, word],
    });
    persistVocab();
  },

  loadVocab(): void {
    try {
      const raw = localStorage.getItem(VOCAB_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        favorites?: FavItem[];
        masked?: string[];
        /** The retired folder shape; its saved words migrate into favourites. */
        folders?: { slots?: ({ word: string; symbol: string; fitzgerald: FitzgeraldClass } | null)[] }[];
      };
      const patch: { favorites?: FavItem[]; maskedCoreWords?: string[] } = {};
      if (Array.isArray(parsed.favorites)) {
        patch.favorites = parsed.favorites;
      } else if (Array.isArray(parsed.folders)) {
        patch.favorites = parsed.folders
          .flatMap((folder) => folder.slots ?? [])
          .filter((cell): cell is { word: string; symbol: string; fitzgerald: FitzgeraldClass } => cell !== null)
          .map((cell) => ({ text: cell.word, symbol: cell.symbol, fitzgerald: cell.fitzgerald }));
      }
      if (Array.isArray(parsed.masked)) patch.maskedCoreWords = parsed.masked;
      store.set(patch);
    } catch {
      /* Corrupt or unavailable storage: fall back to defaults silently. */
    }
  },

  stageSpeech(text: string | null): void {
    store.set({ stagedSpeech: text });
  },

  setPredictions(predictions: Prediction[]): void {
    store.set({ predictions: predictions.slice(0, 3), predicting: false });
  },

  setPredicting(predicting: boolean): void {
    store.set({ predicting });
  },

  setContextSuggestions(words: ContextSuggestion[], phrases: ContextSuggestion[]): void {
    const state = store.getState();
    if (words.length === 0 && phrases.length === 0) {
      store.set({
        contextualWords: [],
        contextualPhrases: [],
        previousContextualWords: [],
        previousContextualPhrases: [],
        contextSuggestionsUpdatedAt: 0,
      });
      return;
    }
    const favorites = state.favorites.map((favorite) => favorite.text);
    const nextWords = filterNovelChoices(
      words,
      'words',
      [
        ...favorites,
        ...state.contextualWords.map((choice) => choice.text),
        ...state.previousContextualWords.map((choice) => choice.text),
      ],
      6,
    );
    const nextPhrases = filterNovelChoices(
      phrases,
      'phrases',
      [
        ...favorites,
        ...state.contextualPhrases.map((choice) => choice.text),
        ...state.previousContextualPhrases.map((choice) => choice.text),
      ],
      4,
    );
    // A fully repeated generation is ignored; it must never erase the useful
    // choices already on screen merely because nothing new was returned.
    if (nextWords.length === 0 && nextPhrases.length === 0) return;

    const signature = (items: readonly ContextSuggestion[]) =>
      items.map((item) => `${item.text}\u0000${item.symbol}`).join('\u0001');
    if (
      signature(nextWords) === signature(state.contextualWords) &&
      signature(nextPhrases) === signature(state.contextualPhrases)
    ) return;

    store.set({
      contextualWords: nextWords,
      contextualPhrases: nextPhrases,
      previousContextualWords: state.contextualWords,
      previousContextualPhrases: state.contextualPhrases,
      contextSuggestionsUpdatedAt: Date.now(),
    });
  },

  setAssistStatus(assistStatus: AppState['assistStatus']): void {
    store.set({ assistStatus });
  },

  recordAssistUsage(
    kind: 'text' | 'image',
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {},
  ): void {
    const whole = (value: number | undefined) => Number.isFinite(value)
      ? Math.max(0, Math.floor(value ?? 0))
      : 0;
    store.set((state) => ({
      assistUsage: {
        ...state.assistUsage,
        textRequests: state.assistUsage.textRequests + (kind === 'text' ? 1 : 0),
        imageRequests: state.assistUsage.imageRequests + (kind === 'image' ? 1 : 0),
        inputTokens: state.assistUsage.inputTokens + whole(usage.inputTokens),
        outputTokens: state.assistUsage.outputTokens + whole(usage.outputTokens),
        totalTokens: state.assistUsage.totalTokens + whole(usage.totalTokens),
      },
    }));
  },

  beginAssistTask(feature: AssistFeature, label = 'Working on the latest request'): string {
    const current = store.getState().assistFeatures[feature];
    const id = `assist-${Date.now()}-${assistTaskSequence += 1}`;
    const task: AssistTaskEntry = {
      id,
      label: label.trim() || 'Working on the latest request',
      status: 'working',
      resultCount: 0,
      startedAt: Date.now(),
      finishedAt: null,
    };
    store.set((state) => ({
      assistFeatures: {
        ...state.assistFeatures,
        [feature]: {
          ...current,
          activeTasks: current.activeTasks + 1,
          status: 'working',
          tasks: [task, ...current.tasks].slice(0, MAX_ASSIST_TASKS),
        },
      },
    }));
    return id;
  },

  finishAssistTask(
    feature: AssistFeature,
    status: Exclude<AssistFeatureStatus, 'working'>,
    resultCount = 0,
    taskId?: string,
  ): void {
    const current = store.getState().assistFeatures[feature];
    const targetIndex = taskId
      ? current.tasks.findIndex((task) => task.id === taskId && task.status === 'working')
      : current.tasks.findIndex((task) => task.status === 'working');
    const completedCount = Math.max(0, Math.floor(resultCount));
    const tasks = targetIndex < 0
      ? current.tasks
      : current.tasks.map((task, index) => index === targetIndex
        ? { ...task, status, resultCount: completedCount, finishedAt: Date.now() }
        : task);
    const activeTasks = tasks.filter((task) => task.status === 'working').length;
    store.set((state) => ({
      assistFeatures: {
        ...state.assistFeatures,
        [feature]: {
          activeTasks,
          status: activeTasks > 0 ? 'working' : status,
          resultCount: completedCount,
          tasks,
        },
      },
    }));
  },

  setAssistFeatureStatus(
    feature: AssistFeature,
    status: Exclude<AssistFeatureStatus, 'working'>,
    resultCount = 0,
  ): void {
    const current = store.getState().assistFeatures[feature];
    const completedCount = Math.max(0, Math.floor(resultCount));
    const tasks = current.tasks.map((task) => task.status === 'working'
      ? { ...task, status, resultCount: completedCount, finishedAt: Date.now() }
      : task);
    store.set((state) => ({
      assistFeatures: {
        ...state.assistFeatures,
        [feature]: { activeTasks: 0, status, resultCount: completedCount, tasks },
      },
    }));
  },

  /**
   * Apply a contextual correction only while the exact recogniser text is
   * still present. A late network answer must never overwrite a user's edit
   * or a newer recognition result.
   */
  applyContextCorrection(
    turnId: string,
    expectedText: string,
    correctedText: string,
    reason: string,
    source: 'chatgpt' | 'on-device' = 'chatgpt',
  ): boolean {
    const turn = store.getState().turns.find((candidate) => candidate.id === turnId);
    const corrected = correctedText.trim();
    if (!turn || !turn.final || !turn.dictated || turn.text !== expectedText) return false;
    if (corrected.length === 0 || corrected === turn.text || corrected.length > 500) return false;

    actions.upsertTurn({
      ...turn,
      text: corrected,
      originalText: turn.originalText ?? turn.text,
      correctionReason: reason.trim().slice(0, 180),
      correctionSource: source,
      // Decoder confidences describe the original token sequence. Keeping
      // them after changing the words would move a squiggle onto the wrong
      // token, which is worse than clearing it.
      words: undefined,
    });
    return true;
  },

  revertContextCorrection(turnId: string): boolean {
    const turn = store.getState().turns.find((candidate) => candidate.id === turnId);
    if (!turn?.originalText) return false;
    actions.upsertTurn({
      ...turn,
      text: turn.originalText,
      originalText: undefined,
      correctionReason: undefined,
      correctionSource: undefined,
    });
    return true;
  },

  /**
   * Upsert a turn.
   *
   * Interim recognition results stream in continuously, so a turn is identified
   * by id and updated in place until it is final. Appending every partial would
   * make the transcript unreadable — and for a screen-reader user, unusable.
   */
  upsertTurn(turn: Partial<Turn> & { id: string; source: TurnSource; text: string }): Turn {
    const state = store.getState();
    const existingIndex = state.turns.findIndex((candidate) => candidate.id === turn.id);

    const existing = existingIndex >= 0 ? state.turns[existingIndex] : undefined;

    // Spread rather than list every field.
    //
    // Listing them meant `speakerId` and `voice` were simply forgotten when they
    // were added, so every update silently discarded the speaker the tracker had
    // just identified and the transcript showed "Unidentified voice" for turns
    // that had been matched perfectly well. TypeScript cannot catch it: both are
    // optional, so omitting them is valid. Spreading makes the safe thing the
    // default — a new optional field carries through without anyone remembering.
    const merged: Turn = {
      ...existing,
      ...turn,
      id: turn.id,
      source: turn.source,
      text: turn.text,
      final: turn.final ?? false,
      at: turn.at ?? existing?.at ?? Date.now(),
      spoken: turn.spoken ?? existing?.spoken ?? false,
      viaRtt: turn.viaRtt ?? existing?.viaRtt ?? false,
      dictated: turn.dictated ?? existing?.dictated ?? false,
    };

    const turns = existingIndex >= 0 ? [...state.turns] : [...state.turns, merged];
    if (existingIndex >= 0) turns[existingIndex] = merged;

    store.set({ turns: turns.length > MAX_TURNS ? turns.slice(-MAX_TURNS) : turns });
    return merged;
  },

  addTurn(source: TurnSource, text: string, options: Partial<Turn> = {}): Turn {
    return actions.upsertTurn({ id: createId('turn'), source, text, final: true, ...options });
  },

  /** Retract a turn — used when a partner clears an in-progress message. */
  removeTurn(id: string): void {
    const turns = store.getState().turns;
    const next = turns.filter((turn) => turn.id !== id);
    if (next.length !== turns.length) store.set({ turns: next });
  },

  clearTurns(): void {
    store.set({ turns: [], predictions: [] });
  },

  setLiveSpeaker(liveSpeaker: AppState['liveSpeaker']): void {
    store.set({ liveSpeaker });
  },

  setSpeakers(
    speakers: SpeakerProfile[],
    voiceAttempts: AttributionAttempt[] = [],
    pendingVoices = 0,
  ): void {
    store.set({ speakers, voiceAttempts, pendingVoices });
  },

  setEngineInfo(engine: 'asr' | 'tts', info: EngineInfo): void {
    store.set({ [engine]: info } as Partial<AppState>);
  },

  setSpeakerModel(status: 'idle' | 'loading' | 'ready' | 'error', detail: string): void {
    store.set({ speakerModel: { status, detail } });
  },

  setSettings(patch: Partial<Settings>): void {
    const settings = { ...store.getState().settings, ...patch };
    store.set({ settings });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* Private browsing or blocked storage: preferences are best-effort. */
    }
  },

  loadSettings(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Only keys that are still settings survive the merge, so retired
      // options lingering in old localStorage cannot come back to life.
      const settings = { ...store.getState().settings };
      for (const key of Object.keys(settings) as (keyof Settings)[]) {
        if (key in parsed) (settings as Record<string, unknown>)[key] = parsed[key];
      }
      store.set({ settings });
    } catch {
      /* Corrupt or unavailable storage: fall back to defaults silently. */
    }
  },

  notify(level: 'info' | 'warning' | 'error', text: string): void {
    const notices = [...store.getState().notices, { id: createId('notice'), level, text }];
    store.set({ notices: notices.slice(-MAX_NOTICES) });
  },

  dismissNotice(id: string): void {
    store.set({ notices: store.getState().notices.filter((notice) => notice.id !== id) });
  },
};

// ---------------------------------------------------------------------------
// Selectors — defined at module scope so their identity is stable.
// ---------------------------------------------------------------------------

export const selectTurns = (state: AppState): Turn[] => state.turns;
export const selectComposition = (state: AppState): string => state.composition;
export const selectCompositionAuthor = (state: AppState): CompositionAuthor => state.compositionAuthor;
export const selectPredictions = (state: AppState): Prediction[] => state.predictions;
export const selectContextualWords = (state: AppState): ContextSuggestion[] => state.contextualWords;
export const selectContextualPhrases = (state: AppState): ContextSuggestion[] => state.contextualPhrases;
export const selectPreviousContextualWords = (state: AppState): ContextSuggestion[] => state.previousContextualWords;
export const selectPreviousContextualPhrases = (state: AppState): ContextSuggestion[] => state.previousContextualPhrases;
export const selectSettings = (state: AppState): Settings => state.settings;
export const selectCompliance = (state: AppState): ComplianceResult[] => state.compliance;
export const selectNotices = (state: AppState): AppState['notices'] => state.notices;

/** The rolling window handed to the prediction ladder and to WebMCP agents. */
export function selectContextWindow(state: AppState): Turn[] {
  return state.turns.filter((turn) => turn.final).slice(-CONTEXT_WINDOW);
}

export function selectTranscriptText(state: AppState): string {
  return selectContextWindow(state)
    .map((turn) => `${turn.source === 'user' ? 'User' : 'Partner'}: ${turn.text}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

/**
 * Subscribe to a slice of the store.
 *
 * The snapshot is memoised on state identity so selectors returning fresh
 * arrays or objects do not send `useSyncExternalStore` into a re-render loop.
 */
export function useStore<S>(selector: (state: AppState) => S): S {
  const cache = useRef<{ state: AppState; value: S } | null>(null);

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    if (cache.current && cache.current.state === state) return cache.current.value;
    const value = selector(state);
    cache.current = { state, value };
    return value;
  }, [selector]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
