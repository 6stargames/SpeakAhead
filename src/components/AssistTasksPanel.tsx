import type { JSX } from 'react';
import {
  ASSIST_FEATURE_ORDER,
  ASSIST_FEATURE_PRESENTATION,
} from '@/assist/featurePresentation';
import {
  useStore,
  type AppState,
  type AssistFeature,
  type AssistFeatureActivity,
  type AssistFeatureStatus,
} from '@/state/store';

const selectAssistActivity = (state: AppState) => ({
  features: state.assistFeatures,
  assistEnabled: state.settings.chatGPTAssist,
  symbolTheme: state.settings.symbolTheme,
});

const STATUS_LABEL: Record<AssistFeatureStatus, string> = {
  idle: 'Waiting',
  working: 'Working now',
  ready: 'Last task finished',
  local: 'On-device fallback',
  unavailable: 'Not connected',
  error: 'Needs attention',
};

function effectiveActivity(
  feature: AssistFeature,
  activity: AssistFeatureActivity,
  assistEnabled: boolean,
  symbolTheme: AppState['settings']['symbolTheme'],
): AssistFeatureActivity {
  if ((feature === 'corrections' || feature === 'suggestions') && !assistEnabled) {
    return { activeTasks: 0, status: 'idle', resultCount: 0 };
  }
  if (feature === 'themes' && symbolTheme === 'emoji') {
    return { activeTasks: 0, status: 'idle', resultCount: 0 };
  }
  return activity;
}

function outcomeText(activity: AssistFeatureActivity): string {
  if (activity.activeTasks > 0) {
    return `${activity.activeTasks} task${activity.activeTasks === 1 ? '' : 's'} running now`;
  }
  if (activity.resultCount > 0) {
    return `${activity.resultCount} result${activity.resultCount === 1 ? '' : 's'} from the last task`;
  }
  if (activity.status === 'unavailable') return 'The service is unavailable; communication still works.';
  if (activity.status === 'error') return 'The last task hit an error; communication still works.';
  if (activity.status === 'local') return 'Using the private on-device fallback.';
  return 'No task is running right now.';
}

export function AssistTasksPanel({
  selectedFeature,
  onClose,
}: {
  selectedFeature: AssistFeature;
  onClose: () => void;
}): JSX.Element {
  const assist = useStore(selectAssistActivity);
  const selectedPresentation = ASSIST_FEATURE_PRESENTATION[selectedFeature];
  const selectedActivity = effectiveActivity(
    selectedFeature,
    assist.features[selectedFeature],
    assist.assistEnabled,
    assist.symbolTheme,
  );

  return (
    <section
      id="webmcp-activity-panel"
      className="card assist-tasks"
      aria-labelledby="assist-tasks-title"
    >
      <header className="assist-tasks__header">
        <div>
          <p className="assist-tasks__eyebrow">ChatGPT · WebMCP</p>
          <h2 id="assist-tasks-title">What it is doing</h2>
        </div>
        <span
          className={`assist-tasks__status assist-tasks__status--${selectedActivity.status}`}
          role="status"
        >
          {STATUS_LABEL[selectedActivity.status]}
        </span>
      </header>

      <div className={`assist-tasks__hero assist-tasks__hero--${selectedActivity.status}`}>
        <span className="assist-tasks__hero-icon" aria-hidden="true">
          {selectedPresentation.icon}
        </span>
        <div>
          <h3>{selectedPresentation.label}</h3>
          <p>{selectedPresentation.task}</p>
          <strong aria-live="polite">{outcomeText(selectedActivity)}</strong>
        </div>
      </div>

      {selectedActivity.activeTasks > 0 && (
        <ol className="assist-tasks__running" aria-label="Tasks running now">
          {Array.from({ length: selectedActivity.activeTasks }, (_, index) => (
            <li key={index}>
              <span className="assist-tasks__spinner" aria-hidden="true" />
              Task {index + 1}: {selectedPresentation.task}
            </li>
          ))}
        </ol>
      )}

      <div className="assist-tasks__all" aria-label="All WebMCP features">
        {ASSIST_FEATURE_ORDER.map((feature) => {
          const presentation = ASSIST_FEATURE_PRESENTATION[feature];
          const activity = effectiveActivity(
            feature,
            assist.features[feature],
            assist.assistEnabled,
            assist.symbolTheme,
          );
          return (
            <article
              key={feature}
              className={`assist-task-row${feature === selectedFeature ? ' assist-task-row--selected' : ''}`}
            >
              <span className="assist-task-row__icon" aria-hidden="true">{presentation.icon}</span>
              <div className="assist-task-row__copy">
                <strong>{presentation.label}</strong>
                <span>{outcomeText(activity)}</span>
              </div>
              <span className={`assist-task-row__state assist-task-row__state--${activity.status}`}>
                {activity.activeTasks > 0 ? activity.activeTasks : STATUS_LABEL[activity.status]}
              </span>
            </article>
          );
        })}
      </div>

      <button
        type="button"
        className="button button--primary assist-tasks__close"
        onClick={onClose}
      >
        Close — back to chat
      </button>
    </section>
  );
}
