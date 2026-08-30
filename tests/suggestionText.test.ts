import { describe, expect, it } from 'vitest';
import { suggestionText, withoutSpokenEmoji } from '@/assist/suggestionText';

describe('AI suggestion text', () => {
  it('reduces a Words-board suggestion to one lexical word', () => {
    expect(suggestionText('more water please', 'words')).toBe('more');
    expect(suggestionText('🧊 ice cream', 'words')).toBe('ice');
  });

  it('keeps the phrase but removes emoji from visible and spoken text', () => {
    expect(suggestionText('💧 Water, please. 🙏', 'phrases')).toBe('Water, please.');
    expect(withoutSpokenEmoji('👋 Hello there!')).toBe('Hello there!');
    expect(withoutSpokenEmoji('1️⃣ One moment.')).toBe('One moment.');
  });
});
