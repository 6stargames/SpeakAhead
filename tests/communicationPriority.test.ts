import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteCommunicationAudio, waitForCommunicationIdle } from '@/assist/communicationPriority';

describe('communication-first background scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps cosmetic work paused until microphone activity has been quiet', async () => {
    noteCommunicationAudio();
    let ready = false;
    const waiting = waitForCommunicationIdle().then(() => {
      ready = true;
    });

    await vi.advanceTimersByTimeAsync(1_400);
    expect(ready).toBe(false);

    await vi.advanceTimersByTimeAsync(101);
    await waiting;
    expect(ready).toBe(true);
  });
});
