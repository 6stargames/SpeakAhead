import type { AssistFeature } from '@/state/store';

export interface AssistFeaturePresentation {
  readonly icon: string;
  readonly label: string;
  readonly task: string;
}

/** Plain-language descriptions shared by the header buttons and activity view. */
export const ASSIST_FEATURE_PRESENTATION: Record<AssistFeature, AssistFeaturePresentation> = {
  corrections: {
    icon: '✎',
    label: 'Context correction',
    task: 'Checking uncertain transcript words against the recent conversation.',
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
}));
