import { describe, expect, it } from 'vitest';
import { normaliseSpeechForPlayback } from '@/audio/AudioGraph';

describe('speech playback loudness', () => {
  it('raises generated speech to a clean near-full-scale peak', () => {
    const output = normaliseSpeechForPlayback(new Float32Array([-0.1, 0.2, -0.4, 0.3]));
    const peak = Math.max(...Array.from(output, (sample) => Math.abs(sample)));

    expect(peak).toBeCloseTo(0.98, 5);
    expect(output[2]).toBeLessThan(0);
  });

  it('does not invent sound from a silent buffer', () => {
    const silence = new Float32Array(32);
    expect(normaliseSpeechForPlayback(silence)).toBe(silence);
  });
});
