import { useMemo, type JSX } from 'react';
import type { SignedInChatGPTIdentity } from '@/auth/chatgpt';
import { ThemedCloseButton } from '@/components/ThemedCloseButton';
import { useStore, type AppState, type AssistFeature, type SymbolTheme } from '@/state/store';

const FEATURES: AssistFeature[] = ['corrections', 'suggestions', 'speech', 'themes'];

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
  symbolTheme = 'emoji',
}: {
  identity: SignedInChatGPTIdentity;
  onClose: () => void;
  symbolTheme?: SymbolTheme;
}): JSX.Element {
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
          <div className="profile-panel__identity">
            <img src="/openai-mark.svg" alt="" />
            <div className="profile-panel__identity-copy">
              <p className="assist-tasks__eyebrow">Signed in with ChatGPT</p>
              <h2 id="profile-panel-title">{identity.displayName}</h2>
              <p>{identity.email}</p>
            </div>
          </div>
          <a
            className="button button--danger profile-panel__signout"
            href={identity.signOutPath}
            target="_top"
          >
            Sign out
          </a>
        </header>

        <div className="profile-panel__metrics" aria-label="SpeakAhead usage">
          <article>
            <strong>{number(usage.textRequests + usage.imageRequests + usage.transcriptionRequests + usage.speechRequests)}</strong>
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

        <div className="profile-panel__token-card">
          <div>
            <span>Total tokens</span>
            <strong>{number(usage.totalTokens)}</strong>
          </div>
          <dl>
            <div><dt>Input</dt><dd>{number(usage.inputTokens)}</dd></div>
            <div><dt>Output</dt><dd>{number(usage.outputTokens)}</dd></div>
            <div><dt>Text requests</dt><dd>{number(usage.textRequests)}</dd></div>
            <div><dt>Transcriptions</dt><dd>{number(usage.transcriptionRequests)}</dd></div>
            <div><dt>Voice requests</dt><dd>{number(usage.speechRequests)}</dd></div>
            <div><dt>New picture requests</dt><dd>{number(usage.imageRequests)}</dd></div>
          </dl>
          <p>
            SpeakAhead usage returned to this page during this session. It is not account-wide
            ChatGPT plan usage; reused saved pictures use no new generation request.
          </p>
        </div>
      </div>

      <div className="assist-tasks__footer">
        <ThemedCloseButton onClose={onClose} symbolTheme={symbolTheme} />
      </div>
    </section>
  );
}
