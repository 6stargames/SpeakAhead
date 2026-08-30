import type { ThemeIconRequestItem } from '@/assist/types';

export const CHATGPT_VOICE_NAMES = [
  'coral',
  'nova',
  'shimmer',
  'cedar',
  'onyx',
  'echo',
  'alloy',
  'marin',
  'sage',
] as const;

export type ChatGptVoiceName = (typeof CHATGPT_VOICE_NAMES)[number];
export type VoiceGender = 'male' | 'female' | 'neutral';

export interface VoiceChoice {
  readonly id: string;
  readonly name: string;
  readonly source: 'device' | 'chatgpt';
  readonly gender: VoiceGender;
  readonly symbol: string;
  readonly character: string;
  readonly mood: string;
  readonly instructions?: string;
}

export const CHATGPT_VOICE_PREFIX = 'chatgpt:';

/**
 * Three device voices and three ChatGPT voices for each Settings voice type.
 * The order is paired so the two-column UI puts one device voice beside one
 * ChatGPT voice on every row.
 */
export const VOICE_CHOICES: readonly VoiceChoice[] = [
  // Female
  {
    id: '582', name: 'Elizabeth', source: 'device', gender: 'female', symbol: '👩',
    character: 'Elizabeth, a clear and expressive adult woman with a reassuring smile',
    mood: 'clear, expressive, confident sapphire rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}coral`, name: 'Coral', source: 'chatgpt', gender: 'female', symbol: '👩‍🎤',
    character: 'Coral, a warm adult woman with an approachable, encouraging expression',
    mood: 'warm, approachable, soft coral rhythm',
    instructions: 'Speak warmly and clearly with an approachable tone and natural pacing.',
  },
  {
    id: '9', name: 'Amanda', source: 'device', gender: 'female', symbol: '👩‍🦰',
    character: 'Amanda, a warm adult woman with natural energy and an encouraging expression',
    mood: 'warm, natural, soft amber rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}nova`, name: 'Nova', source: 'chatgpt', gender: 'female', symbol: '👩‍🚀',
    character: 'Nova, a bright adult woman with lively energy and a confident expression',
    mood: 'bright, energetic, violet and gold rhythm',
    instructions: 'Speak with bright, friendly energy, clear articulation, and a natural conversational pace.',
  },
  {
    id: '1', name: 'Jessica', source: 'device', gender: 'female', symbol: '👩‍💼',
    character: 'Jessica, a crisp and friendly adult woman with an attentive expression',
    mood: 'bright, crisp, rose and blue rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}shimmer`, name: 'Shimmer', source: 'chatgpt', gender: 'female', symbol: '👩‍🎨',
    character: 'Shimmer, a gentle adult woman with a polished, reassuring expression',
    mood: 'gentle, polished, pearly lavender rhythm',
    instructions: 'Speak gently with polished clarity, soft warmth, and steady natural pacing.',
  },

  // Male
  {
    id: '546', name: 'Mark', source: 'device', gender: 'male', symbol: '👨',
    character: 'Mark, a composed adult man with a rich, unhurried expression',
    mood: 'rich, unhurried, deep blue and gold rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}cedar`, name: 'Cedar', source: 'chatgpt', gender: 'male', symbol: '👨‍🎤',
    character: 'Cedar, a composed adult man with a clear, reassuring expression',
    mood: 'clear, grounded, deep teal and gold rhythm',
    instructions: 'Speak clearly and calmly with a grounded, reassuring tone and natural pacing.',
  },
  {
    id: '8', name: 'Craig', source: 'device', gender: 'male', symbol: '👨‍🦱',
    character: 'Craig, a calm adult man with a deep, deliberate expression',
    mood: 'deep, deliberate, midnight green rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}onyx`, name: 'Onyx', source: 'chatgpt', gender: 'male', symbol: '🧔',
    character: 'Onyx, a confident adult man with a steady, assured expression',
    mood: 'deep, assured, charcoal and electric blue rhythm',
    instructions: 'Speak with a deep, assured tone, measured confidence, and very clear diction.',
  },
  {
    id: '5', name: 'Steven', source: 'device', gender: 'male', symbol: '👨‍💼',
    character: 'Steven, a friendly adult man with an even, broadcast-clear expression',
    mood: 'even, broadcast clear, cobalt rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}echo`, name: 'Echo', source: 'chatgpt', gender: 'male', symbol: '👨‍🚀',
    character: 'Echo, a relaxed adult man with a smooth, conversational expression',
    mood: 'smooth, conversational, aqua and navy rhythm',
    instructions: 'Speak smoothly and conversationally with relaxed confidence and crisp articulation.',
  },

  // Neutral
  {
    id: '0', name: 'Ashley', source: 'device', gender: 'neutral', symbol: '🧑',
    character: 'Ashley, a friendly gender-neutral adult with a calm, reassuring expression',
    mood: 'neutral, steady, calm blue rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}alloy`, name: 'Alloy', source: 'chatgpt', gender: 'neutral', symbol: '🧑‍🎤',
    character: 'Alloy, a balanced gender-neutral adult with a bright, attentive expression',
    mood: 'balanced, versatile, silver-blue rhythmic glow',
    instructions: 'Speak with balanced energy, natural intonation, and crisp, easy-to-understand diction.',
  },
  {
    id: '2', name: 'Brett', source: 'device', gender: 'neutral', symbol: '🧑‍🦱',
    character: 'Brett, a direct gender-neutral adult with a relaxed, straightforward expression',
    mood: 'plain-spoken, direct, crisp green rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}marin`, name: 'Marin', source: 'chatgpt', gender: 'neutral', symbol: '🧑‍🎨',
    character: 'Marin, a warm and expressive gender-neutral adult with an open, confident expression',
    mood: 'warm, expressive, flowing coral and violet rhythm',
    instructions: 'Speak naturally with warm expression, clear articulation, and gentle confidence.',
  },
  {
    id: '9', name: 'Amanda', source: 'device', gender: 'neutral', symbol: '🧑‍💼',
    character: 'Amanda, a naturally neutral-sounding adult with an encouraging expression',
    mood: 'warm, natural, balanced amber rhythm',
  },
  {
    id: `${CHATGPT_VOICE_PREFIX}sage`, name: 'Sage', source: 'chatgpt', gender: 'neutral', symbol: '🧑‍🚀',
    character: 'Sage, a thoughtful gender-neutral adult with a composed, reassuring expression',
    mood: 'thoughtful, composed, sage green and violet rhythm',
    instructions: 'Speak thoughtfully with calm confidence, steady pacing, and precise, reassuring diction.',
  },
];

export function voiceChoicesForGender(
  gender: VoiceGender,
  includeChatGpt = true,
): readonly VoiceChoice[] {
  return VOICE_CHOICES.filter(
    (voice) => voice.gender === gender && (includeChatGpt || voice.source === 'device'),
  );
}

export function voicePortraitThemeItem(voice: VoiceChoice): ThemeIconRequestItem {
  return {
    text: `${voice.character}; ${voice.mood} voice portrait`,
    symbol: voice.symbol,
    presentation: 'subject',
  };
}

export function voiceBadgeThemeItem(voice: VoiceChoice): ThemeIconRequestItem {
  return {
    text: `${voice.name} ${voice.gender} voice name badge background; ${voice.mood}`,
    symbol: '▬',
    presentation: 'wallpaper-background',
  };
}

export const VOICE_PORTRAIT_THEME_ITEMS: readonly ThemeIconRequestItem[] = VOICE_CHOICES.map(
  voicePortraitThemeItem,
);

export const VOICE_BADGE_THEME_ITEMS: readonly ThemeIconRequestItem[] = VOICE_CHOICES.map(
  voiceBadgeThemeItem,
);

export function isChatGptVoiceId(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(CHATGPT_VOICE_PREFIX);
}

export function chatGptVoiceName(value: string): ChatGptVoiceName | null {
  if (!isChatGptVoiceId(value)) return null;
  const name = value.slice(CHATGPT_VOICE_PREFIX.length);
  return CHATGPT_VOICE_NAMES.find((voice) => voice === name) ?? null;
}

export function voiceChoice(value: string): VoiceChoice | undefined {
  return VOICE_CHOICES.find((voice) => voice.id === value);
}
