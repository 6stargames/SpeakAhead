import { useMemo, useState, type JSX } from 'react';
import type { SignedInChatGPTIdentity } from '@/auth/chatgpt';
import {
  ASSIST_FEATURE_PRESENTATION,
} from '@/assist/featurePresentation';
import { useStore, type AppState, type AssistFeature } from '@/state/store';

type ProfileView = 'overview' | 'tokens' | 'activity';

const FEATURES: AssistFeature[] = ['corrections', 'suggestions', 'themes'];

const selectProfileUsage = (state: AppState) => ({
  usage: state.assistUsage,
  features: state.assistFeatures,
});

function number(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function ProfilePanel({
  identity,
  onClose,
}: {
  identity: SignedInChatGPTIdentity;
  onClose: () => void;
}): JSX.Element {
  const [view, setView] = useState<ProfileView>('overview');
  const { usage, features } = useStore(selectProfileUsage);
  const tasks = useMemo(
    () => FEATURES.flatMap((feature) => features[feature].tasks),
    [features],
  );
  const activeTasks = tasks.filter((task) => task.status === 'working').length;
  const completedTasks = tasks.filter((task) => task.status !== 'working').length;
  const resultCount = tasks.reduce((total, task) => total + task.resultCount, 0);

  return (
    <section
      id="chatgpt-profile-panel"
      className="card assist-tasks profile-panel"
      aria-labelledby="profile-panel-title"
    >
      <div className="assist-tasks__scroll">
        <header className="profile-panel__header">
          <img src="/openai-mark.svg" alt="" />
          <div>
            <p className="assist-tasks__eyebrow">Signed in with ChatGPT</p>
            <h2 id="profile-panel-title">{identity.displayName}</h2>
            <p>{identity.email}</p>
          </div>
        </header>

        <div className="profile-panel__tabs" role="group" aria-label="Profile details">
          {([
            ['overview', 'Usage'],
            ['tokens', 'Tokens'],
            ['activity', 'Activity'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="button profile-panel__tab"
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'overview' && (
          <div className="profile-panel__metrics" aria-label="SpeakAhead usage">
            <article>
              <strong>{number(usage.textRequests + usage.imageRequests)}</strong>
              <span>AI requests</span>
            </article>
            <article>
              <strong>{number(activeTasks)}</strong>
              <span>active now</span>
            </article>
            <article>
              <strong>{number(completedTasks)}</strong>
              <span>tasks completed</span>
            </article>
            <article>
              <strong>{number(resultCount)}</strong>
              <span>results prepared</span>
            </article>
          </div>
        )}

        {view === 'tokens' && (
          <div className="profile-panel__token-card">
            <div>
              <span>Total tokens</span>
              <strong>{number(usage.totalTokens)}</strong>
            </div>
            <dl>
              <div><dt>Input</dt><dd>{number(usage.inputTokens)}</dd></div>
              <div><dt>Output</dt><dd>{number(usage.outputTokens)}</dd></div>
              <div><dt>Text requests</dt><dd>{number(usage.textRequests)}</dd></div>
              <div><dt>New picture requests</dt><dd>{number(usage.imageRequests)}</dd></div>
            </dl>
            <p>
              SpeakAhead usage returned to this page during this session. It is not account-wide
              ChatGPT plan usage; reused saved pictures use no new generation request.
            </p>
          </div>
        )}

        {view === 'activity' && (
          <div className="profile-panel__activity">
            {FEATURES.map((feature) => {
              const activity = features[feature];
              const presentation = ASSIST_FEATURE_PRESENTATION[feature];
              const completed = activity.tasks.filter((task) => task.status !== 'working').length;
              return (
                <article key={feature}>
                  <span aria-hidden="true">{presentation.icon}</span>
                  <div>
                    <strong>{presentation.label}</strong>
                    <small>{activity.activeTasks} active · {completed} completed</small>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <a
          className="button button--danger profile-panel__signout"
          href={identity.signOutPath}
          target="_top"
        >
          Sign out of ChatGPT
        </a>
      </div>

      <div className="assist-tasks__footer">
        <button
          type="button"
          className="button button--primary assist-tasks__close"
          onClick={onClose}
        >
          Close — back to chat
        </button>
      </div>
    </section>
  );
}
