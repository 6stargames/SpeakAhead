import type { ContextSuggestion } from '@/state/store';

export interface AssistTurnInput {
  readonly id: string;
  readonly source: 'user' | 'peer';
  readonly text: string;
  readonly dictated: boolean;
  readonly words?: readonly { text: string; confidence: number }[];
}

export interface ContextAssistRequest {
  readonly turns: readonly AssistTurnInput[];
  readonly composition: string;
  /** False when this pass is only checking uncertain transcript words. */
  readonly generateSuggestions: boolean;
  /** Device-visible choices that the next generation must not repeat. */
  readonly excludedWords: readonly string[];
  readonly excludedPhrases: readonly string[];
}

export interface ContextCorrection {
  readonly turnId: string;
  readonly originalText: string;
  readonly correctedText: string;
  readonly reason: string;
}

export interface ContextAssistResponse {
  readonly corrections: ContextCorrection[];
  readonly words: ContextSuggestion[];
  readonly phrases: ContextSuggestion[];
}

export interface ThemeIconRequestItem {
  readonly text: string;
  readonly symbol: string;
}

export interface ThemeSprite {
  readonly imageUrl: string;
  readonly columns: number;
  readonly rows: number;
}
