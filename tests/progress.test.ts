import { describe, expect, it } from 'vitest';
import { formatLoadPercent, parseLoadProgress } from '@/lib/progress';

describe('parseLoadProgress', () => {
  it('reads Emscripten byte counts', () => {
    expect(parseLoadProgress('Downloading data... (95475522/190951044)')).toBeCloseTo(0.5, 2);
  });

  it('clamps the overshoot Emscripten produces', () => {
    // Several files are counted against one declared total; it reached 111%
    // in production, and a bar past 100% undermines the point of having one.
    expect(parseLoadProgress('Downloading data... (211951044/190951044)')).toBe(1);
  });

  it('returns null while nothing countable is reported', () => {
    // Model initialisation reports no byte counts, which is much of the wait.
    expect(parseLoadProgress('Preparing...')).toBeNull();
    expect(parseLoadProgress(undefined)).toBeNull();
    expect(parseLoadProgress('')).toBeNull();
  });

  it('refuses a zero or malformed total rather than dividing by it', () => {
    expect(parseLoadProgress('(100/0)')).toBeNull();
    expect(parseLoadProgress('(abc/def)')).toBeNull();
  });

  it('tolerates whitespace around the divider', () => {
    expect(parseLoadProgress('data (10 / 100)')).toBeCloseTo(0.1, 5);
  });
});

describe('formatLoadPercent', () => {
  it('gives whole percents for display', () => {
    expect(formatLoadPercent('(1/3)')).toBe(33);
    expect(formatLoadPercent('(2/3)')).toBe(67);
  });

  it('passes through the absence of progress', () => {
    expect(formatLoadPercent('starting')).toBeNull();
  });
});
