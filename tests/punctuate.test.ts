import { describe, expect, it } from 'vitest';
import { normaliseForMatching, restorePunctuation } from '@/speech/punctuate';

describe('restorePunctuation', () => {
  it('capitalises and terminates a streamed transducer hypothesis', () => {
    expect(restorePunctuation('the quick brown fox jumps over the lazy dog')).toBe(
      'The quick brown fox jumps over the lazy dog.',
    );
  });

  it('marks a question when the sentence opens with an interrogative', () => {
    expect(restorePunctuation('are you coming to lunch')).toBe('Are you coming to lunch?');
    expect(restorePunctuation('what time is it')).toBe('What time is it?');
  });

  it('capitalises the first-person pronoun', () => {
    expect(restorePunctuation('i think i am ready')).toBe('I think I am ready.');
    expect(restorePunctuation("i'm fine")).toBe("I'm fine.");
  });

  it('leaves existing terminal punctuation alone', () => {
    expect(restorePunctuation('Stop!')).toBe('Stop!');
    expect(restorePunctuation('Really?')).toBe('Really?');
  });

  it('collapses runs of whitespace', () => {
    expect(restorePunctuation('  hello    there  ')).toBe('Hello there.');
  });

  it('brings all-caps recogniser output down to sentence case', () => {
    // Several Zipformer models emit uppercase throughout; left alone it reads
    // as shouting, which misrepresents how someone spoke.
    expect(restorePunctuation('WHAT WOULD YOU LIKE TO DRINK WITH YOUR LUNCH TODAY')).toBe(
      'What would you like to drink with your lunch today?',
    );
  });

  it('leaves ordinary mixed-case text alone', () => {
    expect(restorePunctuation('I am doing well')).toBe('I am doing well.');
  });

  it('does not mangle a single capital letter or initialism-free text', () => {
    expect(restorePunctuation('A')).toBe('A.');
  });

  it('returns an empty string for empty input', () => {
    expect(restorePunctuation('   ')).toBe('');
  });
});

describe('normaliseForMatching', () => {
  it('strips the cosmetic layer so matching is stable', () => {
    expect(normaliseForMatching('Are you in PAIN, right now?')).toBe('are you in pain right now');
  });

  it('keeps apostrophes, which carry meaning in contractions', () => {
    expect(normaliseForMatching("I'm fine.")).toBe("i'm fine");
  });
});
