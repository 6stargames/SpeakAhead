import { describe, expect, it } from 'vitest';
import { speakerHue } from '@/lib/speakerColour';

describe('speakerHue', () => {
  it('is stable for a given speaker', () => {
    expect(speakerHue('speaker-3')).toBe(speakerHue('speaker-3'));
  });

  it('separates consecutive speakers widely on the wheel', () => {
    const first = speakerHue('speaker-1') as number;
    const second = speakerHue('speaker-2') as number;
    const distance = Math.min(Math.abs(first - second), 360 - Math.abs(first - second));
    // Adjacent hues would be indistinguishable in a waveform, which is the one
    // place the colour has to do real work.
    expect(distance).toBeGreaterThan(60);
  });

  it('keeps the first speaker calm rather than alarming', () => {
    expect(speakerHue('speaker-1')).toBe(215);
  });

  it('returns nothing for an unknown voice', () => {
    expect(speakerHue(null)).toBeNull();
    expect(speakerHue(undefined)).toBeNull();
    expect(speakerHue('not-a-speaker')).toBeNull();
  });

  it('stays within the colour wheel however many speakers there are', () => {
    for (let i = 1; i <= 40; i += 1) {
      const hue = speakerHue(`speaker-${i}`) as number;
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
