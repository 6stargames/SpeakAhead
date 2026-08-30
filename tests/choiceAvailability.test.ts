import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CORE_WORD_TEXTS,
  FIXED_PHRASE_TEXTS,
  choiceAlreadyAvailable,
  filterNovelChoices,
  joinPhraseTokens,
} from '@/assist/choiceAvailability';
import { requestContextAssist } from '@/assist/client';
import { CORE_THEME_ITEMS } from '@/components/CoreBoard';
import { PHRASE_THEME_ITEMS } from '@/components/PhraseBoard';

afterEach(() => vi.unstubAllGlobals());

describe('context choice availability', () => {
  it('keeps the permanent availability lists aligned with both fixed boards', () => {
    expect(new Set(CORE_WORD_TEXTS)).toEqual(new Set(CORE_THEME_ITEMS.map((item) => item.text)));
    expect(new Set(FIXED_PHRASE_TEXTS)).toEqual(new Set(PHRASE_THEME_ITEMS.map((item) => item.text)));
  });

  it('joins generated phrase tokens with real spaces', () => {
    expect(joinPhraseTokens(['I', 'agree.'])).toBe('I agree.');
    expect(joinPhraseTokens(['Tell me', 'more', '.'])).toBe('Tell me more.');
  });

  it('recognises punctuation variants and shortened fixed phrases as unavailable', () => {
    expect(choiceAlreadyAvailable('HELP', 'words')).toBe(true);
    expect(choiceAlreadyAvailable('Please stop', 'phrases')).toBe(true);
    expect(choiceAlreadyAvailable('I need help', 'phrases')).toBe(true);
    expect(choiceAlreadyAvailable('I agree.', 'phrases')).toBe(false);
  });

  it('removes permanent, previous, favourite, and same-generation duplicates', () => {
    const choices = filterNovelChoices(
      [
        { text: 'help' },
        { text: 'water' },
        { text: 'Water' },
        { text: 'later' },
        { text: 'again' },
      ],
      'words',
      ['later'],
    );
    expect(choices.map((choice) => choice.text)).toEqual(['water', 'again']);
  });

  it('filters a bad API response again before it can reach the board', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      corrections: [],
      words: [
        { text: 'help', symbol: '🆘' },
        { text: 'water', symbol: '💧' },
        { text: 'later', symbol: '⏳' },
      ],
      phrases: [
        { text: 'Please stop', symbol: '✋' },
        { text: 'I need help', symbol: '🆘' },
        { text: 'I agree.', symbol: '✅' },
        { text: 'Tell me more.', symbol: '💬' },
      ],
    }), { status: 200 })));

    const result = await requestContextAssist({
      turns: [{ id: 'turn', source: 'peer', text: 'What do you think?', dictated: true }],
      composition: '',
      generateSuggestions: true,
      excludedWords: ['later'],
      excludedPhrases: ['Tell me more.'],
    });

    expect(result?.words.map((choice) => choice.text)).toEqual(['water']);
    expect(result?.phrases.map((choice) => choice.text)).toEqual(['I agree.']);
  });
});
