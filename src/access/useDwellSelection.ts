import { useEffect, useRef } from 'react';

/**
 * Dwell selection for eye-gaze access (Task 05 of the round-two brief).
 *
 * Commercial eye trackers drive the browser as an emulated pointer, so dwell
 * is implemented on pointer position: resting the pointer on a button for the
 * dwell time presses it. A centre-out radial ring fills over the target for
 * the whole dwell, so the user always sees how far a selection has progressed
 * and can look away to cancel.
 *
 * The Midas-touch problem is answered architecturally, not by documentation:
 *
 *  - Only buttons dwell. Text, transcripts, labels, gutters, and the
 *    dedicated rest zones are inert — the gaze can park on any of them
 *    indefinitely.
 *  - After a selection fires, the same target will not fire again until the
 *    gaze has left it. Reading the word just selected costs nothing.
 *  - The 8px board gutters double as drift tolerance: a gaze wobbling between
 *    two cells lands in dead space rather than the wrong cell.
 */

export interface DwellOptions {
  enabled: boolean;
  /** Clinically validated range 350–1000ms. */
  dwellMs: number;
}

const RING_SIZE = 48;

export function useDwellSelection({ enabled, dwellMs }: DwellOptions): void {
  const dwellRef = useRef(dwellMs);
  dwellRef.current = dwellMs;

  useEffect(() => {
    if (!enabled) return undefined;

    const ring = document.createElement('div');
    ring.className = 'dwell-ring';
    ring.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ring);

    let current: HTMLElement | null = null;
    let startedAt = 0;
    let fired: HTMLElement | null = null;
    let raf = 0;

    const hide = (): void => {
      ring.style.display = 'none';
      current = null;
    };

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      if (!current) return;
      const progress = Math.min(1, (now - startedAt) / dwellRef.current);
      // Re-measure every frame: the ring must track the target through
      // scrolling without ever lagging a stale rectangle.
      const rect = current.getBoundingClientRect();
      ring.style.left = `${rect.left + rect.width / 2 - RING_SIZE / 2}px`;
      ring.style.top = `${rect.top + rect.height / 2 - RING_SIZE / 2}px`;
      ring.style.setProperty('--dwell-progress', `${progress * 360}deg`);
      if (progress >= 1) {
        const target = current;
        fired = target;
        hide();
        target.click();
      }
    };

    const onMove = (event: PointerEvent): void => {
      const element = event.target instanceof Element ? event.target : null;
      const button = element?.closest<HTMLElement>('button:not(:disabled)') ?? null;

      // A fired target stays quiet until the gaze leaves it entirely.
      if (fired && button === fired) return;
      if (fired && button !== fired) fired = null;

      if (!button) {
        hide();
        return;
      }
      if (button === current) return;

      current = button;
      startedAt = performance.now();
      ring.style.display = 'block';
    };

    raf = requestAnimationFrame(frame);
    window.addEventListener('pointermove', onMove, true);

    return () => {
      window.removeEventListener('pointermove', onMove, true);
      cancelAnimationFrame(raf);
      ring.remove();
    };
  }, [enabled]);
}
