import type { JSX } from 'react';
import type { ChatGPTIdentity } from '@/auth/chatgpt';
import { ASSIST_FEATURE_PRESENTATION } from '@/assist/featurePresentation';
import {
  useStore,
  type AppState,
  type AssistFeature,
  type AssistFeatureActivity,
  type AssistFeatureStatus,
} from '@/state/store';

const selectAssistHeader = (state: AppState) => ({
  features: state.assistFeatures,
  assistEnabled: state.settings.chatGPTAssist,
  symbolTheme: state.settings.symbolTheme,
});

const STATUS_TEXT: Record<AssistFeatureStatus, string> = {
  idle: 'waiting',
  working: 'working',
  ready: 'ready',
  local: 'on-device fallback',
  unavailable: 'not connected',
  error: 'error',
};

function FeatureIndicator({
  icon,
  label,
  activity,
  overrideStatus,
  overrideDetail,
  selected,
  onSelect,
}: {
  icon: string;
  label: string;
  activity: AssistFeatureActivity;
  overrideStatus?: AssistFeatureStatus;
  overrideDetail?: string;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const status = overrideStatus ?? activity.status;
  const count = overrideStatus ? 0 : activity.activeTasks;
  const badgeCount = count > 0 || overrideStatus ? count : activity.resultCount;
  const resultDetail = activity.resultCount > 0
    ? ` ${activity.resultCount} result${activity.resultCount === 1 ? '' : 's'} from the last pass.`
    : '';
  const title = `${label}: ${overrideDetail ?? STATUS_TEXT[status]}. ${count} task${count === 1 ? '' : 's'} working.${resultDetail}`;

  return (
    <button
      type="button"
      className={`assist-feature assist-feature--${status}`}
      title={title}
      aria-label={title}
      aria-pressed={selected}
      aria-controls="webmcp-activity-panel"
      aria-expanded={selected}
      onClick={onSelect}
    >
      <span className="assist-feature__icon" aria-hidden="true">{icon}</span>
      <span className="assist-feature__count" aria-hidden="true">{badgeCount}</span>
    </button>
  );
}

/** Sites authentication overlaid inside the otherwise untouched ribbon. */
export function ChatGPTAuthButton({
  identity,
  selectedFeature = null,
  onFeatureSelect = () => undefined,
}: {
  identity: ChatGPTIdentity | null;
  selectedFeature?: AssistFeature | null;
  onFeatureSelect?: (feature: AssistFeature) => void;
}): JSX.Element | null {
  const assist = useStore(selectAssistHeader);
  if (!identity) return null;

  if ('signInPath' in identity) {
    return (
      <a
        className="chatgpt-auth-overlay"
        href={identity.signInPath}
        target="_top"
        aria-label="Sign in with ChatGPT"
      >
        <span className="chatgpt-auth-overlay__mark" aria-hidden="true">✦</span>
        <span>ChatGPT sign in</span>
      </a>
    );
  }

  const contextOverride = assist.assistEnabled ? undefined : 'idle';
  const contextDetail = assist.assistEnabled ? undefined : 'turned off in Settings';
  const themeOverride = assist.symbolTheme !== 'emoji' ? undefined : 'idle';
  const themeDetail = assist.symbolTheme !== 'emoji' ? undefined : 'Emoji theme selected';

  return (
    <div className="chatgpt-auth-cluster" aria-label="ChatGPT and WebMCP activity">
      <a
        className="chatgpt-auth-overlay chatgpt-auth-overlay--signed-in"
        href={identity.signOutPath}
        target="_top"
        title={`${identity.email} · Sign out`}
        aria-label={`Signed in with ChatGPT as ${identity.displayName}. Sign out`}
      >
        <span className="chatgpt-auth-overlay__mark" aria-hidden="true">✓</span>
        <span className="chatgpt-auth-overlay__name">{identity.displayName}</span>
      </a>
      <div className="assist-features" aria-label="WebMCP features">
        <FeatureIndicator
          icon={ASSIST_FEATURE_PRESENTATION.corrections.icon}
          label={ASSIST_FEATURE_PRESENTATION.corrections.label}
          activity={assist.features.corrections}
          overrideStatus={contextOverride}
          overrideDetail={contextDetail}
          selected={selectedFeature === 'corrections'}
          onSelect={() => onFeatureSelect('corrections')}
        />
        <FeatureIndicator
          icon={ASSIST_FEATURE_PRESENTATION.suggestions.icon}
          label={ASSIST_FEATURE_PRESENTATION.suggestions.label}
          activity={assist.features.suggestions}
          overrideStatus={contextOverride}
          overrideDetail={contextDetail}
          selected={selectedFeature === 'suggestions'}
          onSelect={() => onFeatureSelect('suggestions')}
        />
        <FeatureIndicator
          icon={ASSIST_FEATURE_PRESENTATION.themes.icon}
          label={ASSIST_FEATURE_PRESENTATION.themes.label}
          activity={assist.features.themes}
          overrideStatus={themeOverride}
          overrideDetail={themeDetail}
          selected={selectedFeature === 'themes'}
          onSelect={() => onFeatureSelect('themes')}
        />
      </div>
    </div>
  );
}
