import { describe, expect, it } from 'vitest';
import {
  CHATGPT_VOICE_NAMES,
  VOICE_CHOICES,
  chatGptVoiceName,
  voiceChoicesForGender,
} from '@/speech/tts/voiceChoices';

describe('voice choices', () => {
  it.each(['female', 'male', 'neutral'] as const)(
    'shows three device and three OpenAI choices for %s',
    (gender) => {
      const choices = voiceChoicesForGender(gender);
      expect(choices).toHaveLength(6);
      expect(choices.filter((voice) => voice.source === 'device')).toHaveLength(3);
      expect(choices.filter((voice) => voice.source === 'chatgpt')).toHaveLength(3);
      expect(choices.map((voice) => voice.source)).toEqual([
        'device', 'chatgpt', 'device', 'chatgpt', 'device', 'chatgpt',
      ]);
      expect(choices.every((voice) => voice.gender === gender)).toBe(true);
    },
  );

  it('offers all 18 gender-specific entries without showing other groups', () => {
    expect(VOICE_CHOICES).toHaveLength(18);
    expect(voiceChoicesForGender('female').some((voice) => voice.gender !== 'female')).toBe(false);
    expect(voiceChoicesForGender('male').some((voice) => voice.gender !== 'male')).toBe(false);
    expect(voiceChoicesForGender('neutral').some((voice) => voice.gender !== 'neutral')).toBe(false);
  });

  it('uses exactly the nine supported OpenAI voice ids selected for the UI', () => {
    const openAiChoices = VOICE_CHOICES.filter((voice) => voice.source === 'chatgpt');
    expect(openAiChoices).toHaveLength(9);
    expect(new Set(openAiChoices.map((voice) => chatGptVoiceName(voice.id)))).toEqual(
      new Set(CHATGPT_VOICE_NAMES),
    );
    expect(openAiChoices.every((voice) => Boolean(voice.instructions))).toBe(true);
  });

  it('keeps signed-out users on the three device choices for their selected group', () => {
    const choices = voiceChoicesForGender('neutral', false);
    expect(choices).toHaveLength(3);
    expect(choices.every((voice) => voice.source === 'device')).toBe(true);
  });
});
