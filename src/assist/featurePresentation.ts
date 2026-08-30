import type { AssistFeature } from '@/state/store';

export interface AssistFeaturePresentation {
  readonly icon: string;
  readonly label: string;
  readonly task: string;
}

/** Plain-language descriptions shared by the header buttons and activity view. */
export const ASSIST_FEATURE_PRESENTATION: Record<AssistFeature, AssistFeaturePresentation> = {
  corrections: {
    icon: '🎧',
    label: 'Accurate transcription',
    task: 'Checking completed ONNX speech with GPT transcription.',
  },
  suggestions: {
    icon: '💬',
    label: 'Quick replies',
    task: 'Preparing one-word choices and reply phrases from the conversation.',
  },
  themes: {
    icon: '🎨',
    label: 'Themed pictures',
    task: 'Generating and saving pictures for the selected button theme.',
  },
};

export const ASSIST_FEATURE_ORDER: readonly AssistFeature[] = [
  'corrections',
  'suggestions',
  'themes',
];

/** The tool buttons use the same themed-picture pipeline as communication cards. */
export const ASSIST_FEATURE_THEME_ITEMS = ASSIST_FEATURE_ORDER.map((feature) => ({
  text: ASSIST_FEATURE_PRESENTATION[feature].label,
  symbol: ASSIST_FEATURE_PRESENTATION[feature].icon,
  presentation: 'control-icon' as const,
}));

/** Full-width panel art stays abstract so activity text remains the subject. */
export const ASSIST_FEATURE_PANEL_THEME_ITEMS = ASSIST_FEATURE_ORDER.map((feature) => ({
  text: feature === 'corrections'
    ? 'Accurate transcription abstract audio rhythm panel'
    : feature === 'suggestions'
      ? 'Quick replies abstract conversational flow panel'
      : 'Themed pictures abstract creative colour panel',
  symbol: '▬',
  presentation: 'wallpaper-background' as const,
}));
