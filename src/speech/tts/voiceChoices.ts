import type { ThemeIconRequestItem } from '@/assist/types';

export type ChatGptVoiceName = 'marin' | 'cedar' | 'alloy';

export interface VoiceChoice {
  readonly id: string;
  readonly name: string;
  readonly source: 'device' | 'chatgpt';
  readonly symbol: string;
  readonly character: string;
  readonly mood: string;
  readonly instructions?: string;
}

export const CHATGPT_VOICE_PREFIX = 'chatgpt:';

/** Three familiar offline voices paired with three natural ChatGPT voices. */
export const VOICE_CHOICES: readonly VoiceChoice[] = [
  {
    id: '0',
    name: 'Ashley',
    source: 'device',
    symbol: '👩',
    character: 'Ashley, a friendly adult woman with a calm, reassuring expression',
    mood: 'neutral, steady, calm blue rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}marin`,
    name: 'Marin',
    source: 'chatgpt',
    symbol: '🧑‍🎤',
    character: 'Marin, a warm and expressive androgynous adult with an open, confident expression',
    mood: 'warm, expressive, flowing coral and violet rhythm',
    instructions: 'Speak naturally with warm expression, clear articulation, and gentle confidence.',
  },
  {
    id: '9',
    name: 'Amanda',
    source: 'device',
    symbol: '👩‍🦰',
    character: 'Amanda, a warm adult woman with natural energy and an encouraging expression',
    mood: 'warm, natural, soft amber rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}cedar`,
    name: 'Cedar',
    source: 'chatgpt',
    symbol: '👨',
    character: 'Cedar, a composed adult man with a clear, reassuring expression',
    mood: 'clear, grounded, deep teal and gold rhythm',
    instructions: 'Speak clearly and calmly with a grounded, reassuring tone and natural pacing.',
  },
  {
    id: '2',
    name: 'Brett',
    source: 'device',
    symbol: '👨‍🦱',
    character: 'Brett, a direct adult man with a relaxed, straightforward expression',
    mood: 'plain-spoken, direct, crisp green rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}alloy`,
    name: 'Alloy',
    source: 'chatgpt',
    symbol: '🧑',
    character: 'Alloy, a balanced gender-neutral adult with a bright, attentive expression',
    mood: 'balanced, versatile, silver-blue rhythmic glow',
    instructions: 'Speak with balanced energy, natural intonation, and crisp, easy-to-understand diction.',
  },
];

export const VOICE_PORTRAIT_THEME_ITEMS: readonly ThemeIconRequestItem[] = VOICE_CHOICES.map(
  (voice) => ({
    text: `${voice.character}; ${voice.mood} voice portrait`,
    symbol: voice.symbol,
    presentation: 'subject' as const,
  }),
);

export const VOICE_BADGE_THEME_ITEMS: readonly ThemeIconRequestItem[] = VOICE_CHOICES.map(
  (voice) => ({
    text: `${voice.name} voice name badge background; ${voice.mood}`,
    symbol: '▬',
    presentation: 'wallpaper-background' as const,
  }),
);

export function isChatGptVoiceId(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(CHATGPT_VOICE_PREFIX);
}

export function chatGptVoiceName(value: string): ChatGptVoiceName | null {
  if (!isChatGptVoiceId(value)) return null;
  const name = value.slice(CHATGPT_VOICE_PREFIX.length);
  return name === 'marin' || name === 'cedar' || name === 'alloy' ? name : null;
}

export function voiceChoice(value: string): VoiceChoice | undefined {
  return VOICE_CHOICES.find((voice) => voice.id === value);
}
