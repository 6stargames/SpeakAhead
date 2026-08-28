import type { PredictionSourceId } from '@/state/store';

export interface PredictionContext {
  /** Most recent last, oldest first. Already limited to the rolling window. */
  readonly turns: readonly { source: 'user' | 'peer'; text: string }[];
  readonly composition: string;
}

export interface PredictionSource {
  readonly id: PredictionSourceId;
  readonly label: string;
  available(): Promise<boolean>;
  predict(context: PredictionContext): Promise<string[]>;
  expand(shorthand: string, context: PredictionContext): Promise<string>;
}
