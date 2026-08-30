import type { JSX } from 'react';
import type { ChatGPTIdentity } from '@/auth/chatgpt';
import {
  ASSIST_FEATURE_PRESENTATION,
  ASSIST_FEATURE_THEME_ITEMS,
} from '@/assist/featurePresentation';
import {
  ThemedSymbol,
  themeTileFor,
  useThemedSymbols,
  type ThemeTile,
} from '@/assist/themeIcons';
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
  tile,
  label,
  activity,
  overrideStatus,
  overrideDetail,
  selected,
  onSelect,
}: {
  icon: string;
  tile?: ThemeTile;
  label: string;
  activity: AssistFeatureActivity;
  overrideStatus?: AssistFeatureStatus;
  overrideDetail?: string;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const status = overrideStatus ?? activity.status;
  const count = overrideStatus ? 0 : activity.activeTasks;
  const title = `${label}: ${overrideDetail ?? STATUS_TEXT[status]}. ${count} active task${count === 1 ? '' : 's'}.`;

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
      <span className="assist-feature__icon" aria-hidden="true">
        <ThemedSymbol symbol={icon} tile={tile} />
      </span>
      {count > 0 && <span className="assist-feature__count" aria-hidden="true">{count}</span>}
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
  const signedIn = Boolean(identity && !('signInPath' in identity));
  const featureTiles = useThemedSymbols(
    ASSIST_FEATURE_THEME_ITEMS,
    signedIn ? assist.symbolTheme : 'emoji',
    { batchSize: 3, singleSubject: true },
  );
  if (!identity) return null;

  if ('signInPath' in identity) {
    return (
      <a
        className="chatgpt-auth-overlay"
        href={identity.signInPath}
        target="_top"
        aria-label="Sign in with ChatGPT"
      >
        <img className="chatgpt-auth-overlay__mark" src="/openai-mark.svg" alt="" />
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
        <img className="chatgpt-auth-overlay__mark" src="/openai-mark.svg" alt="" />
        <span className="chatgpt-auth-overlay__name">{identity.displayName}</span>
      </a>
      <div className="assist-features" aria-label="WebMCP features">
        <FeatureIndicator
          icon={ASSIST_FEATURE_PRESENTATION.corrections.icon}
          tile={themeTileFor(featureTiles, ASSIST_FEATURE_THEME_ITEMS[0]!)}
          label={ASSIST_FEATURE_PRESENTATION.corrections.label}
          activity={assist.features.corrections}
          overrideStatus={contextOverride}
          overrideDetail={contextDetail}
          selected={selectedFeature === 'corrections'}
          onSelect={() => onFeatureSelect('corrections')}
        />
        <FeatureIndicator
          icon={ASSIST_FEATURE_PRESENTATION.suggestions.icon}
          tile={themeTileFor(featureTiles, ASSIST_FEATURE_THEME_ITEMS[1]!)}
          label={ASSIST_FEATURE_PRESENTATION.suggestions.label}
          activity={assist.features.suggestions}
          overrideStatus={contextOverride}
          overrideDetail={contextDetail}
          selected={selectedFeature === 'suggestions'}
          onSelect={() => onFeatureSelect('suggestions')}
        />
        <FeatureIndicator
          icon={ASSIST_FEATURE_PRESENTATION.themes.icon}
          tile={themeTileFor(featureTiles, ASSIST_FEATURE_THEME_ITEMS[2]!)}
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
