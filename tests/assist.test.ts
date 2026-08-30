import { describe, expect, it } from 'vitest';
import { localWordSuggestions, symbolForText } from '@/assist/fallback';

describe('private context fallback', () => {
  it('always provides six useful word choices with familiar fallback symbols', () => {
    const suggestions = localWordSuggestions([{ text: 'Would you like cold water?' }]);
    expect(suggestions).toHaveLength(6);
    expect(suggestions[0]?.text).toBe('water');
    expect(symbolForText('water')).toBe('💧');
  });
});
