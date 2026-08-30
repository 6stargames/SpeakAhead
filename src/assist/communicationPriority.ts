/**
 * Cosmetic background work must yield to live communication.
 *
 * Audio inference runs in a worker, but microphone frames still cross the main
 * thread on their way there. Large image responses used to be decoded and
 * cached immediately, which could delay those frame messages long enough for
 * streaming recognition to appear to stop. This tiny scheduler records recent
 * microphone activity without touching React state, then lets themed imagery
 * continue only after the room has been quiet for a moment.
 */

const QUIET_WINDOW_MS = 1_500;
const MAX_POLL_MS = 250;

let lastCommunicationAudioAt = Number.NEGATIVE_INFINITY;

export function noteCommunicationAudio(): void {
  lastCommunicationAudioAt = Date.now();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForBrowserIdle(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof window.requestIdleCallback === 'function') {
    await new Promise<void>((resolve) => {
      window.requestIdleCallback(() => resolve(), { timeout: 750 });
    });
    return;
  }
  await delay(0);
}

export async function waitForCommunicationIdle(): Promise<void> {
  while (true) {
    const remaining = QUIET_WINDOW_MS - (Date.now() - lastCommunicationAudioAt);
    if (remaining <= 0) {
      await waitForBrowserIdle();
      // Speech may have started while the browser was waiting for an idle turn.
      if (Date.now() - lastCommunicationAudioAt >= QUIET_WINDOW_MS) return;
      continue;
    }
    await delay(Math.min(remaining, MAX_POLL_MS));
  }
}
