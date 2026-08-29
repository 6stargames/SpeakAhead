import type { JSX } from 'react';
import type { ChatGPTIdentity } from '@/auth/chatgpt';
import {
  useStore,
  type AppState,
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
}: {
  icon: string;
  label: string;
  activity: AssistFeatureActivity;
  overrideStatus?: AssistFeatureStatus;
  overrideDetail?: string;
}): JSX.Element {
  const status = overrideStatus ?? activity.status;
  const count = overrideStatus ? 0 : activity.activeTasks;
  const badgeCount = count > 0 || overrideStatus ? count : activity.resultCount;
  const resultDetail = activity.resultCount > 0
    ? ` ${activity.resultCount} result${activity.resultCount === 1 ? '' : 's'} from the last pass.`
    : '';
  const title = `${label}: ${overrideDetail ?? STATUS_TEXT[status]}. ${count} task${count === 1 ? '' : 's'} working.${resultDetail}`;

  return (
    <span
      className={`assist-feature assist-feature--${status}`}
      title={title}
      aria-label={title}
      role="status"
    >
      <span className="assist-feature__icon" aria-hidden="true">{icon}</span>
      <span className="assist-feature__count" aria-hidden="true">{badgeCount}</span>
    </span>
  );
}

/** Sites authentication overlaid inside the otherwise untouched ribbon. */
export function ChatGPTAuthButton({
  identity,
}: {
  identity: ChatGPTIdentity | null;
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
  const themeOverride = assist.symbolTheme === 'anime' ? undefined : 'idle';
  const themeDetail = assist.symbolTheme === 'anime' ? undefined : 'Emoji theme selected';

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
          icon="✎"
          label="Context correction"
          activity={assist.features.corrections}
          overrideStatus={contextOverride}
          overrideDetail={contextDetail}
        />
        <FeatureIndicator
          icon="💬"
          label="Quick replies"
          activity={assist.features.suggestions}
          overrideStatus={contextOverride}
          overrideDetail={contextDetail}
        />
        <FeatureIndicator
          icon="🎨"
          label="Themed pictures"
          activity={assist.features.themes}
          overrideStatus={themeOverride}
          overrideDetail={themeDetail}
        />
      </div>
    </div>
  );
}
