/**
 * Load progress for the WebAssembly speech engines.
 *
 * Sherpa reports progress through Emscripten's status line, which looks like
 * "Downloading data... (12345678/190951044)". Turning that into a fraction is
 * the only way to tell someone how much longer a 190 MB model has to go.
 */

const PROGRESS_PATTERN = /\((\d+)\s*\/\s*(\d+)\)/;

/**
 * @returns a fraction between 0 and 1, or null when the detail carries no
 *   countable progress (which is most of the loading time - model
 *   initialisation reports nothing).
 */
export function parseLoadProgress(detail: string | undefined): number | null {
  if (!detail) return null;

  const match = PROGRESS_PATTERN.exec(detail);
  if (!match) return null;

  const loaded = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return null;

  // Emscripten counts several files against one declared total, so the raw
  // ratio overshoots - it reached 111% in production. A progress bar that
  // passes 100% undermines the one thing it exists to communicate.
  return Math.min(1, Math.max(0, loaded / total));
}

/** Whole percent for display, or null when there is nothing countable yet. */
export function formatLoadPercent(detail: string | undefined): number | null {
  const fraction = parseLoadProgress(detail);
  return fraction === null ? null : Math.round(fraction * 100);
}
