import type { ContextSuggestion } from '@/state/store';

export interface AssistTurnInput {
  readonly id: string;
  readonly source: 'user' | 'peer';
  readonly text: string;
  readonly dictated: boolean;
}

export interface ContextAssistRequest {
  readonly turns: readonly AssistTurnInput[];
  readonly composition: string;
  /** Device-visible choices that the next generation must not repeat. */
  readonly excludedWords: readonly string[];
  readonly excludedPhrases: readonly string[];
}

export interface ContextAssistResponse {
  readonly words: ContextSuggestion[];
  readonly phrases: ContextSuggestion[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
}

export interface ThemeIconRequestItem {
  readonly text: string;
  readonly symbol: string;
  /**
   * Communication choices illustrate their meaning. Functional controls keep
   * the supplied glyph recognisable, while a button background is decorative.
   */
  readonly presentation?: 'subject' | 'control-icon' | 'button-background';
}

export interface ThemeSprite {
  readonly imageUrl: string;
  readonly columns: number;
  readonly rows: number;
}
