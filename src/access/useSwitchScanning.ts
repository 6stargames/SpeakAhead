import { useEffect, useRef } from 'react';

/**
 * Row–column switch scanning (Task 04 of the round-two brief).
 *
 * A highlight walks the interface in two levels: first whole rows, then the
 * items inside the chosen row. Every commercial switch interface box delivers
 * its switches as keyboard events, so the contract here is:
 *
 *   primary switch   = Space
 *   secondary switch = Enter
 *
 * In 'auto' mode the highlight advances on a timer; the primary switch
 * selects, and the secondary reverses the scan direction (recovering a missed
 * target costs one press, not a full loop). In 'step' mode the primary switch
 * advances at the user's own pace and the secondary selects — more presses,
 * no timer pressure.
 *
 * Global interrupt, non-negotiable: holding the primary switch for two
 * seconds jumps the scan straight to the emergency bar from anywhere in the
 * loop. A physiological emergency must never wait for a scan cycle.
 *
 * Rows come from the DOM each tick, not from a cached model: any container
 * marked `data-scan` contributes its enabled, visible buttons as one row, and
 * a container marked `data-scan="grid"` contributes one row per visual row of
 * buttons (grouped by vertical position). Recomputing per tick means view
 * switches, masking, and appearing controls are simply picked up — the scan
 * order is always the truth on screen.
 */

export interface ScanOptions {
  enabled: boolean;
  mode: 'auto' | 'step';
  rateMs: number;
}

const HOLD_INTERRUPT_MS = 2000;

function collectRows(): HTMLElement[][] {
  const rows: HTMLElement[][] = [];
  for (const container of document.querySelectorAll<HTMLElement>('[data-scan]')) {
    const buttons = [...container.querySelectorAll<HTMLElement>('button')].filter(
      (button) =>
        !button.hasAttribute('disabled') &&
        button.offsetParent !== null &&
        // A nested scan group owns its own buttons; without this they would
        // be collected twice, once per ancestor.
        button.closest('[data-scan]') === container,
    );
    if (buttons.length === 0) continue;

    if (container.dataset.scan === 'grid') {
      // One scan row per visual row: group by top edge, tolerant of subpixel
      // differences. The visual grid is the motor plan; the scan follows it.
      const groups: { top: number; items: HTMLElement[] }[] = [];
      for (const button of buttons) {
        const top = button.getBoundingClientRect().top;
        const group = groups.find((candidate) => Math.abs(candidate.top - top) < 8);
        if (group) group.items.push(button);
        else groups.push({ top, items: [button] });
      }
      groups.sort((a, b) => a.top - b.top);
      for (const group of groups) rows.push(group.items);
    } else {
      rows.push(buttons);
    }
  }
  return rows;
}

function clearHighlights(): void {
  for (const el of document.querySelectorAll('.scan-row, .scan-item')) {
    el.classList.remove('scan-row', 'scan-item');
  }
}

export function useSwitchScanning({ enabled, mode, rateMs }: ScanOptions): void {
  const options = useRef({ mode, rateMs });
  options.current = { mode, rateMs };

  useEffect(() => {
    if (!enabled) return undefined;

    // Scan-position state lives in plain refs-by-closure: it changes many
    // times a second and must never cause React renders.
    let level: 'row' | 'item' = 'row';
    let rowIndex = 0;
    let itemIndex = 0;
    let direction = 1;
    let rows: HTMLElement[][] = [];
    let timer: number | null = null;
    let holdTimer: number | null = null;
    let holdFired = false;
    let spaceDown = false;

    const paint = (): void => {
      clearHighlights();
      rows = collectRows();
      if (rows.length === 0) return;
      rowIndex = ((rowIndex % rows.length) + rows.length) % rows.length;
      const row = rows[rowIndex];
      if (!row || row.length === 0) return;
      if (level === 'row') {
        for (const el of row) el.classList.add('scan-row');
        row[0]?.scrollIntoView({ block: 'nearest' });
      } else {
        itemIndex = ((itemIndex % row.length) + row.length) % row.length;
        const item = row[itemIndex];
        if (!item) return;
        item.classList.add('scan-item');
        item.scrollIntoView({ block: 'nearest' });
      }
    };

    const advance = (steps: number): void => {
      if (level === 'row') rowIndex += steps;
      else itemIndex += steps;
      paint();
    };

    const select = (): void => {
      if (rows.length === 0) return;
      if (level === 'row') {
        level = 'item';
        itemIndex = 0;
        paint();
        return;
      }
      const target = rows[rowIndex]?.[itemIndex];
      // Back to row scanning at the same row: repeated selections in one area
      // (word, word, delete word) should not restart the loop from the top.
      level = 'row';
      itemIndex = 0;
      target?.click();
      paint();
    };

    /** Jump the scan straight to the emergency bar, from anywhere. */
    const interrupt = (): void => {
      rows = collectRows();
      const emergencyIndex = rows.findIndex((row) => row[0]?.closest('.emergency') !== null);
      if (emergencyIndex >= 0) {
        rowIndex = emergencyIndex;
        level = 'item';
        itemIndex = 0;
      }
      paint();
    };

    const restartTimer = (): void => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      if (options.current.mode === 'auto') {
        timer = window.setInterval(() => advance(direction), options.current.rateMs);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      // Scanning owns these keys completely while enabled. A switch user has
      // no other use for them, and letting a focused button also react to
      // Space would double-activate everything the scanner selects.
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;

      if (event.key === ' ') {
        spaceDown = true;
        holdFired = false;
        holdTimer = window.setTimeout(() => {
          holdFired = true;
          interrupt();
        }, HOLD_INTERRUPT_MS);
        return; // The press acts on release, so a hold can become the interrupt.
      }

      // Secondary switch.
      if (options.current.mode === 'auto') {
        direction = -direction;
        restartTimer();
        advance(direction);
      } else {
        select();
      }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      if (!spaceDown) return;
      spaceDown = false;
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      holdTimer = null;
      if (holdFired) return; // The hold already became the emergency interrupt.

      if (options.current.mode === 'auto') select();
      else advance(1);
    };

    paint();
    restartTimer();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      if (timer !== null) window.clearInterval(timer);
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      clearHighlights();
    };
    // Rebuild on mode or rate changes too: they are rare (a settings tap) and
    // restarting the loop is the correct behaviour for both.
  }, [enabled, mode, rateMs]);
}
