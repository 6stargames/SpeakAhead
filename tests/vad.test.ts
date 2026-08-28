import { describe, expect, it } from 'vitest';
import { amplitudeToDb, EnergyVad } from '@/speech/vad';

const QUIET = 0.001; // ≈ -60 dBFS room tone
const LOUD = 0.2; // ≈ -14 dBFS speech

function feed(vad: EnergyVad, level: number, frames: number): (string | null)[] {
  return Array.from({ length: frames }, () => vad.process(level));
}

describe('amplitudeToDb', () => {
  it('maps full scale to 0 dB', () => {
    expect(amplitudeToDb(1)).toBeCloseTo(0, 6);
  });

  it('floors true silence rather than returning -Infinity', () => {
    expect(amplitudeToDb(0)).toBe(-100);
  });
});

describe('EnergyVad', () => {
  it('stays closed through the calibration window', () => {
    const vad = new EnergyVad();
    expect(feed(vad, QUIET, 8).every((event) => event === null)).toBe(true);
    expect(vad.active).toBe(false);
  });

  it('opens on speech and closes after the hangover', () => {
    const vad = new EnergyVad({ minSpeechFrames: 2, hangoverFrames: 4 });
    feed(vad, QUIET, 8);

    const onset = feed(vad, LOUD, 4);
    expect(onset).toContain('speech-start');
    expect(vad.active).toBe(true);

    const offset = feed(vad, QUIET, 6);
    expect(offset).toContain('speech-end');
    expect(vad.active).toBe(false);
  });

  it('rides out a brief pause mid-sentence instead of chopping the utterance', () => {
    const vad = new EnergyVad({ minSpeechFrames: 2, hangoverFrames: 10 });
    feed(vad, QUIET, 8);
    feed(vad, LOUD, 3);

    // A stop consonant is a couple of frames of near-silence, not a turn end.
    expect(feed(vad, QUIET, 3).every((event) => event === null)).toBe(true);
    expect(vad.active).toBe(true);

    expect(feed(vad, LOUD, 3).every((event) => event === null)).toBe(true);
    expect(vad.active).toBe(true);
  });

  it('needs sustained energy, so a single click does not open it', () => {
    const vad = new EnergyVad({ minSpeechFrames: 3 });
    feed(vad, QUIET, 8);
    expect(vad.process(LOUD)).toBeNull();
    expect(vad.active).toBe(false);
  });

  it('adapts its floor to a noisy room instead of latching open', () => {
    const noisy = new EnergyVad();
    feed(noisy, 0.02, 8);
    // Room tone well above the absolute floor must not read as speech.
    expect(feed(noisy, 0.02, 30).every((event) => event === null)).toBe(true);
    expect(noisy.active).toBe(false);
    expect(noisy.noiseFloorDb).toBeGreaterThan(-45);
  });

  it('still detects speech that is loud relative to a noisy room', () => {
    const vad = new EnergyVad({ minSpeechFrames: 2 });
    feed(vad, 0.02, 20);
    expect(feed(vad, 0.35, 4)).toContain('speech-start');
  });

  it('returns to its initial state on reset', () => {
    const vad = new EnergyVad();
    feed(vad, QUIET, 8);
    feed(vad, LOUD, 4);
    expect(vad.active).toBe(true);

    vad.reset();
    expect(vad.active).toBe(false);
    expect(vad.process(LOUD)).toBeNull();
  });

  it('applies hysteresis so the gate does not chatter at the threshold', () => {
    const vad = new EnergyVad({ activationDb: 12, releaseDb: 4, minSpeechFrames: 1, hangoverFrames: 20 });
    feed(vad, QUIET, 8);
    feed(vad, LOUD, 2);
    expect(vad.active).toBe(true);

    // Between the release and activation thresholds: still counted as speech.
    const marginal = QUIET * 10 ** (8 / 20);
    expect(feed(vad, marginal, 5).every((event) => event === null)).toBe(true);
    expect(vad.active).toBe(true);
  });
});
