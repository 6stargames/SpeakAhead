import { describe, expect, it } from 'vitest';
import { alignWordsToText, UNCERTAIN_BELOW, wordConfidences } from '@/speech/confidence';

describe('wordConfidences', () => {
  it('folds BPE tokens into words with geometric-mean confidence', () => {
    // " hel" "lo" " world": two words; "hello" spans two tokens.
    const words = wordConfidences([' hel', 'lo', ' world'], [-0.1, -0.3, -0.05]);
    expect(words).toHaveLength(2);
    expect(words?.[0]?.text).toBe('hello');
    expect(words?.[0]?.confidence).toBeCloseTo(Math.exp(-0.2), 5);
    expect(words?.[1]?.text).toBe('world');
    expect(words?.[1]?.confidence).toBeCloseTo(Math.exp(-0.05), 5);
  });

  it('handles the ▁ word-start convention too', () => {
    const words = wordConfidences(['▁good', '▁morn', 'ing'], [-0.02, -0.9, -1.1]);
    expect(words?.map((word) => word.text)).toEqual(['good', 'morning']);
  });

  it('one bad token drags its whole word honestly', () => {
    const words = wordConfidences([' cert', 'ainly'], [-0.05, -3.0]);
    expect(words?.[0]?.confidence).toBeLessThan(UNCERTAIN_BELOW);
  });

  it('returns null for missing or mismatched evidence', () => {
    expect(wordConfidences(null, null)).toBeNull();
    expect(wordConfidences([' a'], [])).toBeNull();
    expect(wordConfidences([], [])).toBeNull();
    expect(wordConfidences([' a'], [Number.NaN])).toBeNull();
  });
});

describe('alignWordsToText', () => {
  const words = [
    { text: 'hello', confidence: 0.95 },
    { text: 'wrold', confidence: 0.2 },
  ];

  it('marks low-confidence words through restored punctuation', () => {
    // Restoration capitalised and added a period; positions still align.
    const aligned = alignWordsToText('Hello wrold.', words);
    expect(aligned).toEqual([
      { text: 'Hello', uncertain: false },
      { text: 'wrold.', uncertain: true },
    ]);
  });

  it('refuses to mark anything when the counts disagree', () => {
    // A squiggle under the wrong word is worse than none.
    expect(alignWordsToText('three words here', words)).toBeNull();
    expect(alignWordsToText('Hello', words)).toBeNull();
  });

  it('returns null with no evidence', () => {
    expect(alignWordsToText('Hello there.', null)).toBeNull();
    expect(alignWordsToText('Hello there.', [])).toBeNull();
  });
});
