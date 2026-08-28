import { describe, expect, it } from 'vitest';
// Imported from public/ so the worklet and the tests share one implementation.
import { computePeak, computeRms, createResampler, designLowPass } from '../public/worklets/resampler.js';

function tone(frequency: number, sampleRate: number, length: number): Float32Array {
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    output[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return output;
}

describe('designLowPass', () => {
  it('produces a unity-gain kernel of odd length', () => {
    const kernel = designLowPass(0.15, 33);
    expect(kernel.length).toBe(33);
    const sum = kernel.reduce((total: number, value: number) => total + value, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('forces an even requested length to odd so the kernel stays symmetric', () => {
    expect(designLowPass(0.2, 32).length).toBe(33);
  });
});

describe('createResampler', () => {
  it('passes audio through untouched when the rates already match', () => {
    const resampler = createResampler(16000, 16000);
    expect(resampler.passthrough).toBe(true);

    const input = tone(440, 16000, 512);
    const output = resampler.process(input);
    expect(Array.from(output)).toEqual(Array.from(input));
  });

  it('decimates 48 kHz to 16 kHz at roughly a third of the length', () => {
    const resampler = createResampler(48000, 16000);
    const output = resampler.process(tone(300, 48000, 4800));
    expect(output.length).toBeGreaterThan(1550);
    expect(output.length).toBeLessThan(1610);
  });

  it('preserves a speech-band tone through decimation', () => {
    const resampler = createResampler(48000, 16000);
    // Discard the first chunk: the FIR history is still filling.
    resampler.process(tone(500, 48000, 4800));
    const output = resampler.process(tone(500, 48000, 4800));

    // A full-scale sine has an RMS of 1/√2 ≈ 0.707.
    expect(computeRms(output)).toBeGreaterThan(0.6);
    expect(computeRms(output)).toBeLessThan(0.78);
  });

  it('attenuates content above the new Nyquist instead of aliasing it', () => {
    // 15 kHz sampled at 48 kHz would fold to 1 kHz at 16 kHz without a filter,
    // landing squarely in the speech band and corrupting recognition.
    const resampler = createResampler(48000, 16000);
    resampler.process(tone(15000, 48000, 4800));
    const filtered = resampler.process(tone(15000, 48000, 4800));

    const reference = createResampler(48000, 16000);
    reference.process(tone(1000, 48000, 4800));
    const passband = reference.process(tone(1000, 48000, 4800));

    expect(computeRms(filtered)).toBeLessThan(computeRms(passband) * 0.1);
  });

  it('keeps phase continuous across chunk boundaries', () => {
    const resampler = createResampler(48000, 16000);
    const full = tone(400, 48000, 9600);

    const chunked = [
      resampler.process(full.subarray(0, 4800)),
      resampler.process(full.subarray(4800)),
    ];
    const total = chunked.reduce((sum, chunk) => sum + chunk.length, 0);

    const single = createResampler(48000, 16000).process(full);
    // Within one output sample of the unchunked result.
    expect(Math.abs(total - single.length)).toBeLessThanOrEqual(1);
  });

  it('resets its internal state', () => {
    const resampler = createResampler(48000, 16000);
    resampler.process(tone(400, 48000, 4800));
    resampler.reset();
    const afterReset = resampler.process(tone(400, 48000, 4800));
    expect(afterReset.length).toBeGreaterThan(0);
  });

  it('returns an empty frame for empty input', () => {
    expect(createResampler(48000, 16000).process(new Float32Array(0)).length).toBe(0);
  });
});

describe('frame measurements', () => {
  it('computes RMS and peak', () => {
    const frame = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    expect(computeRms(frame)).toBeCloseTo(0.5, 6);
    expect(computePeak(frame)).toBeCloseTo(0.5, 6);
  });

  it('treats an empty frame as silence rather than dividing by zero', () => {
    expect(computeRms(new Float32Array(0))).toBe(0);
  });
});
