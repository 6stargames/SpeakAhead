import { describe, expect, it } from 'vitest';
import { expandShorthand, predictResponses } from '@/prediction/heuristic';

describe('expandShorthand — the specification’s worked examples', () => {
  it('expands "water cold please" as specified', () => {
    expect(expandShorthand('water cold please')).toBe('I would like some cold water, please.');
  });

  it('expands "apple juice" as specified', () => {
    expect(expandShorthand('apple juice')).toBe('I would like some apple juice, please.');
  });
});

describe('expandShorthand — determiners', () => {
  it('uses "some" for mass nouns', () => {
    expect(expandShorthand('water')).toBe('I would like some water, please.');
  });

  it('uses "a" for count nouns', () => {
    expect(expandShorthand('blanket')).toBe('I would like a blanket, please.');
  });

  it('uses "an" before a vowel', () => {
    expect(expandShorthand('umbrella')).toBe('I would like an umbrella, please.');
  });

  it('omits the determiner for abstract nouns', () => {
    // "I need some help" is not what anyone says.
    expect(expandShorthand('need help')).toBe('I need help.');
    expect(expandShorthand('need rest')).toBe('I need rest.');
    expect(expandShorthand('quiet')).toBe('I would like quiet, please.');
  });

  it('takes the determiner from the head noun of a compound', () => {
    // "apple" is a count noun but "juice" is the head, so "some" is correct.
    expect(expandShorthand('apple juice')).toContain('some apple juice');
  });
});

describe('expandShorthand — intent', () => {
  it('renders feelings as a statement about the speaker', () => {
    expect(expandShorthand('tired')).toBe('I am tired.');
    expect(expandShorthand('cold hungry')).toBe('I am cold and hungry.');
  });

  it('handles verb-led requests', () => {
    expect(expandShorthand('need help')).toBe('I need help.');
    expect(expandShorthand('go bathroom')).toBe('I would like to go to the bathroom, please.');
    expect(expandShorthand('call nurse')).toBe('Could you call my nurse, please.');
  });

  it('produces a question for help requests', () => {
    expect(expandShorthand('help')).toBe('Could you help me, please?');
    expect(expandShorthand('open window')).toBe('Could you open the window, please?');
  });

  it('handles bare affirmation and refusal', () => {
    expect(expandShorthand('yes please')).toBe('Yes, please.');
    expect(expandShorthand('no')).toBe('No, thank you.');
  });

  it('respects negation of a request', () => {
    expect(expandShorthand('no water')).toBe('I do not want some water.');
  });

  it('turns a trailing question mark into a question', () => {
    expect(expandShorthand('water?')).toBe('Could I have some water, please?');
  });

  it('returns nothing for empty input rather than a stray full stop', () => {
    expect(expandShorthand('   ')).toBe('');
  });

  it('always ends with terminal punctuation', () => {
    for (const input of ['water', 'tired', 'need help', 'go outside', 'apple juice']) {
      expect(expandShorthand(input)).toMatch(/[.!?]$/);
    }
  });

  it('defaults to politeness — a bare noun from an AAC user is a request', () => {
    expect(expandShorthand('water')).toContain('please');
  });
});

describe('predictResponses', () => {
  it('answers the specification’s drink question with drink options', () => {
    const suggestions = predictResponses({
      turns: [{ source: 'peer', text: 'What would you like to drink with your lunch today?' }],
      composition: '',
    });

    expect(suggestions).toHaveLength(3);
    expect(suggestions).toContain('Water, please.');
    expect(suggestions.some((text) => /tea/i.test(text))).toBe(true);
    expect(suggestions.some((text) => /nothing/i.test(text))).toBe(true);
  });

  it('offers medical answers to a pain question', () => {
    const suggestions = predictResponses({
      turns: [{ source: 'peer', text: 'Are you in pain right now?' }],
      composition: '',
    });
    expect(suggestions.some((text) => /pain/i.test(text))).toBe(true);
    expect(suggestions.some((text) => /medication/i.test(text))).toBe(true);
  });

  it('falls back to yes/no for an unrecognised closed question', () => {
    const suggestions = predictResponses({
      turns: [{ source: 'peer', text: 'Did the delivery arrive on Tuesday?' }],
      composition: '',
    });
    expect(suggestions).toContain('Yes, please.');
  });

  it('continues the sentence when the user is mid-composition', () => {
    const suggestions = predictResponses({ turns: [], composition: 'I need' });
    expect(suggestions).toHaveLength(3);
    expect(suggestions.every((text) => text.toLowerCase().startsWith('i need'))).toBe(true);
  });

  it('offers an expansion of whatever shorthand is being typed', () => {
    const suggestions = predictResponses({ turns: [], composition: 'water cold' });
    expect(suggestions).toContain('I would like some cold water, please.');
  });

  it('gives usable defaults with no conversation at all', () => {
    expect(predictResponses({ turns: [], composition: '' })).toHaveLength(3);
  });

  it('reads the most recent partner turn, not the first', () => {
    const suggestions = predictResponses({
      turns: [
        { source: 'peer', text: 'Are you in pain?' },
        { source: 'user', text: 'No.' },
        { source: 'peer', text: 'Would you like something to drink?' },
      ],
      composition: '',
    });
    expect(suggestions).toContain('Water, please.');
  });
});
