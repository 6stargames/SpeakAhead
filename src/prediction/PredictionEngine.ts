import type { PredictionSourceId } from '@/state/store';
import { heuristicPredictionSource } from './heuristic';
import { onDeviceModelPredictionSource } from './onDeviceModel';
import type { PredictionContext, PredictionSource } from './types';

export interface PredictionOutcome {
  readonly suggestions: string[];
  readonly source: PredictionSourceId;
  readonly fallbackReason?: string;
}

export interface ExpansionOutcome {
  readonly text: string;
  readonly source: PredictionSourceId;
  readonly fallbackReason?: string;
}

/**
 * The prediction ladder.
 *
 * Signed-in contextual choices are prepared by the ChatGPT assistance flow.
 * This engine provides the on-device fallback used by the older suggestion
 * strip when that assistance is unavailable.
 *
 * Ordering is deliberate. The on-device model produces better language; the
 * rule engine cannot fail. Trying them in that order means the device is never
 * worse than deterministic, and is often better.
 */
export class PredictionEngine {
  #sources: PredictionSource[] = [onDeviceModelPredictionSource, heuristicPredictionSource];
  #availability = new Map<PredictionSourceId, boolean>();

  /** Probe once at startup so the UI can name the active tier honestly. */
  async detect(): Promise<PredictionSourceId[]> {
    const available: PredictionSourceId[] = [];
    for (const source of this.#sources) {
      let ok = false;
      try {
        ok = await source.available();
      } catch {
        ok = false;
      }
      this.#availability.set(source.id, ok);
      if (ok) available.push(source.id);
    }
    return available;
  }

  activeSource(): PredictionSourceId {
    for (const source of this.#sources) {
      if (this.#availability.get(source.id)) return source.id;
    }
    return 'heuristic';
  }

  async predict(context: PredictionContext): Promise<PredictionOutcome> {
    let fallbackReason: string | undefined;

    for (const source of this.#sources) {
      if (this.#availability.get(source.id) === false) continue;
      try {
        const suggestions = await source.predict(context);
        if (suggestions.length > 0) {
          return { suggestions: suggestions.slice(0, 3), source: source.id, fallbackReason };
        }
      } catch (error) {
        // Record why we dropped a tier, then keep going. The user gets
        // suggestions either way; the reason shows up in the status panel.
        fallbackReason = `${source.label}: ${error instanceof Error ? error.message : String(error)}`;
        this.#availability.set(source.id, false);
      }
    }

    return {
      suggestions: await heuristicPredictionSource.predict(context),
      source: 'heuristic',
      fallbackReason,
    };
  }

  async expand(shorthand: string, context: PredictionContext): Promise<ExpansionOutcome> {
    let fallbackReason: string | undefined;

    for (const source of this.#sources) {
      if (this.#availability.get(source.id) === false) continue;
      try {
        const text = await source.expand(shorthand, context);
        if (text.trim().length > 0) return { text: text.trim(), source: source.id, fallbackReason };
      } catch (error) {
        fallbackReason = `${source.label}: ${error instanceof Error ? error.message : String(error)}`;
        this.#availability.set(source.id, false);
      }
    }

    return {
      text: await heuristicPredictionSource.expand(shorthand, context),
      source: 'heuristic',
      fallbackReason,
    };
  }
}

export const predictionEngine = new PredictionEngine();
