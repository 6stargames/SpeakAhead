import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import {
  ASSIST_FEATURE_PANEL_THEME_ITEMS,
  ASSIST_FEATURE_PRESENTATION,
} from '@/assist/featurePresentation';
import { themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import { ThemedCloseButton } from '@/components/ThemedCloseButton';
import {
  useStore,
  type AppState,
  type AssistFeature,
  type AssistFeatureActivity,
  type AssistFeatureStatus,
  type AssistTaskEntry,
  type AssistTaskStatus,
  type SymbolTheme,
} from '@/state/store';

const FEATURE_INDEX: Record<AssistFeature, number> = {
  corrections: 0,
  suggestions: 1,
  speech: 2,
  themes: 3,
};

const selectAssistActivity = (state: AppState) => ({
  features: state.assistFeatures,
  symbolTheme: state.settings.symbolTheme,
});

const STATUS_LABEL: Record<AssistFeatureStatus, string> = {
  idle: 'Waiting',
  working: 'Active',
  ready: 'Completed',
  local: 'Completed on device',
  unavailable: 'Service unavailable',
  error: 'Needs attention',
};

const TASK_STATUS_LABEL: Record<AssistTaskStatus, string> = {
  ...STATUS_LABEL,
  queued: 'Waiting',
};

function effectiveActivity(
  feature: AssistFeature,
  activity: AssistFeatureActivity,
  symbolTheme: AppState['settings']['symbolTheme'],
): AssistFeatureActivity {
  if (feature === 'themes' && symbolTheme === 'emoji') {
    return { ...activity, activeTasks: 0, status: 'idle' };
  }
  return activity;
}

function taskOrder(a: AssistTaskEntry, b: AssistTaskEntry): number {
  const rank = (task: AssistTaskEntry) => task.status === 'working'
    ? 0
    : task.status === 'queued' ? 1 : 2;
  const rankDifference = rank(a) - rank(b);
  if (rankDifference !== 0) return rankDifference;
  if (a.status === 'queued' && b.status === 'queued') {
    return (a.queuedAt ?? a.startedAt) - (b.queuedAt ?? b.startedAt);
  }
  return b.startedAt - a.startedAt;
}

function taskResult(task: AssistTaskEntry): string | null {
  if (task.status === 'working' || task.status === 'queued' || task.resultCount === 0) return null;
  return `${task.resultCount} result${task.resultCount === 1 ? '' : 's'}`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1_000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

export function assistTaskDuration(task: AssistTaskEntry, now = Date.now()): string {
  const finishedAt = task.finishedAt ?? now;
  return formatDuration(finishedAt - task.startedAt);
}

export function assistTaskWaitDuration(task: AssistTaskEntry, now = Date.now()): string {
  if (task.queuedAt == null) return '0.0s';
  const milliseconds = task.status === 'queued'
    ? now - task.queuedAt
    : task.waitDurationMs ?? task.startedAt - task.queuedAt;
  return formatDuration(milliseconds);
}

export function AssistTasksPanel({
  selectedFeature,
  onClose,
  symbolTheme = 'emoji',
}: {
  selectedFeature: AssistFeature;
  onClose: () => void;
  symbolTheme?: SymbolTheme;
}): JSX.Element {
  const assist = useStore(selectAssistActivity);
  const presentation = ASSIST_FEATURE_PRESENTATION[selectedFeature];
  const panelItem = ASSIST_FEATURE_PANEL_THEME_ITEMS[FEATURE_INDEX[selectedFeature]]!;
  const panelTiles = useThemedSymbols([panelItem], symbolTheme, {
    batchSize: 1,
    singleSubject: true,
  });
  const panelTile = themeTileFor(panelTiles, panelItem);
  const panelStyle: CSSProperties | undefined = panelTile
    ? {
      backgroundImage: [
        'linear-gradient(color-mix(in srgb, var(--surface-raised) 68%, transparent), color-mix(in srgb, var(--surface-raised) 78%, transparent))',
        `url(${JSON.stringify(panelTile.imageUrl)})`,
      ].join(', '),
      backgroundPosition: 'center, center 52%',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
    }
    : undefined;
  const activity = effectiveActivity(
    selectedFeature,
    assist.features[selectedFeature],
    assist.symbolTheme,
  );
  const tasks = [...activity.tasks].sort(taskOrder);
  const queuedTasks = tasks.filter((task) => task.status === 'queued').length;
  const hasLiveTask = tasks.some((task) => (
    task.status === 'working' || task.status === 'queued'
  ));
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!hasLiveTask) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [hasLiveTask]);
  const headerStatus = activity.activeTasks > 0 && queuedTasks > 0
    ? `${activity.activeTasks} active · ${queuedTasks} waiting`
    : activity.activeTasks > 0
      ? `${activity.activeTasks} active`
      : queuedTasks > 0
        ? `${queuedTasks} waiting`
        : STATUS_LABEL[activity.status];
  const panelStatus: AssistFeatureStatus = activity.activeTasks > 0
    ? 'working'
    : queuedTasks > 0 ? 'idle' : activity.status;

  return (
    <section
      id="webmcp-activity-panel"
      className="card assist-tasks"
      aria-labelledby="assist-tasks-title"
    >
      <div className="assist-tasks__scroll">
        <div
          className={`assist-tasks__hero assist-tasks__hero--${panelStatus}${
            panelTile ? ' assist-tasks__hero--pictured' : ''
          }`}
          style={panelStyle}
        >
          <div>
            <header className="assist-tasks__hero-header">
              <div>
                <p className="assist-tasks__eyebrow">ChatGPT · WebMCP</p>
                <h2 id="assist-tasks-title">{presentation.label}</h2>
              </div>
              <span
                className={`assist-tasks__status assist-tasks__status--${panelStatus}`}
                role="status"
              >
                {headerStatus}
              </span>
            </header>
            <p>{presentation.task}</p>
            <strong aria-live="polite">
              {activity.activeTasks > 0 || queuedTasks > 0
                ? [
                  activity.activeTasks > 0
                    ? `${activity.activeTasks} active`
                    : null,
                  queuedTasks > 0
                    ? `${queuedTasks} waiting`
                    : null,
                ].filter(Boolean).join(' · ')
                : `${tasks.length} recent task${tasks.length === 1 ? '' : 's'}`}
            </strong>
          </div>
        </div>

        {tasks.length > 0 ? (
          <ol className="assist-tasks__list" aria-label={`${presentation.label} activity`}>
            {tasks.map((task) => {
              const result = taskResult(task);
              const duration = assistTaskDuration(task, now);
              const waitDuration = assistTaskWaitDuration(task, now);
              const queuedBeforeStarting = task.queuedAt != null;
              const timing = task.status === 'queued'
                ? `Waiting · ${waitDuration}`
                : queuedBeforeStarting
                  ? `${task.status === 'working' ? 'Running' : TASK_STATUS_LABEL[task.status]} · Waited ${waitDuration} · Active ${duration}`
                  : `${task.status === 'working' ? 'Running' : TASK_STATUS_LABEL[task.status]} · ${duration}`;
              return (
                <li key={task.id} className={`assist-task-row assist-task-row--${task.status}`}>
                  {(task.status === 'working' || task.status === 'queued') && (
                    <span
                      className={`assist-tasks__spinner${
                        task.status === 'queued' ? ' assist-tasks__spinner--queued' : ''
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  <div className="assist-task-row__copy">
                    <strong>{task.label}</strong>
                    <span>
                      {timing}
                      {result ? ` · ${result}` : ''}
                    </span>
                  </div>
                  <span className={`assist-task-row__state assist-task-row__state--${task.status}`}>
                    {task.status === 'working' ? 'Active' : TASK_STATUS_LABEL[task.status]}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="assist-tasks__empty">No activity yet for this feature.</p>
        )}
      </div>

      <div className="assist-tasks__footer">
        <ThemedCloseButton onClose={onClose} symbolTheme={symbolTheme} />
      </div>
    </section>
  );
}
