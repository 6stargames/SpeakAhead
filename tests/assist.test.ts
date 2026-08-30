import { describe, expect, it } from 'vitest';
import { localContextCorrection, localWordSuggestions, symbolForText } from '@/assist/fallback';

describe('private context fallback', () => {
  it('repairs an uncertain near-match that already appeared in the conversation', () => {
    const correction = localContextCorrection(
      {
        text: 'I want watter',
        words: [
          { text: 'I', confidence: 0.99 },
          { text: 'want', confidence: 0.97 },
          { text: 'watter', confidence: 0.28 },
        ],
      },
      [{ text: 'Would you like some water?' }],
    );

    expect(correction?.correctedText).toBe('I want water');
  });

  it('leaves confident and novel words alone', () => {
    expect(
      localContextCorrection(
        { text: 'I want watter', words: [{ text: 'I', confidence: 0.99 }, { text: 'want', confidence: 0.99 }, { text: 'watter', confidence: 0.9 }] },
        [{ text: 'Would you like water?' }],
      ),
    ).toBeNull();

    expect(
      localContextCorrection(
        { text: 'I need medicine', words: [{ text: 'I', confidence: 0.99 }, { text: 'need', confidence: 0.99 }, { text: 'medicine', confidence: 0.2 }] },
        [{ text: 'Would you like water?' }],
      ),
    ).toBeNull();
  });

  it('always provides six useful word choices with familiar fallback symbols', () => {
    const suggestions = localWordSuggestions([{ text: 'Would you like cold water?' }]);
    expect(suggestions).toHaveLength(6);
    expect(suggestions[0]?.text).toBe('water');
    expect(symbolForText('water')).toBe('💧');
  });
});
