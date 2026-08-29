import { useEffect, useState, type JSX } from 'react';
import type { ChatGPTIdentity } from '@/auth/chatgpt';
import { ChatGPTAuthButton } from '@/components/ChatGPTAuthButton';
import { CoreBoard } from '@/components/CoreBoard';
import { EmergencyBar } from '@/components/EmergencyBar';
import { FringeBoard } from '@/components/FringeBoard';
import { NoticeStack } from '@/components/NoticeStack';
import { OutputRibbon } from '@/components/OutputRibbon';
import { PhraseBoard } from '@/components/PhraseBoard';
import { SettingsPanel } from '@/components/SettingsPanel';
import { SuggestionStrip } from '@/components/SuggestionStrip';
import { TranscriptLog } from '@/components/TranscriptLog';
import { VerificationPanel } from '@/components/VerificationPanel';
import { VoicePanel } from '@/components/VoicePanel';
import { session } from '@/session/AacSession';
import { actions, selectSettings, useStore, type AppState } from '@/state/store';
import { useAacWebMcpTools } from '@/webmcp/tools';

/**
 * The board area shows exactly one of these; the spine switches between
 * them. The conversation is not a view any more — it is always on screen,
 * to the left of the spine, because a communication device with its ears
 * hidden behind a tab kept surprising its user.
 */
type View = 'core' | 'fringe' | 'phrases' | 'voice' | 'settings' | 'diagnostics';

/** The speaking surfaces, at the top of the spine where the hand lives. */
const BOARD_VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'fringe', label: 'Favs', icon: '⭐' },
  { id: 'phrases', label: 'Phrases', icon: '💬' },
  { id: 'core', label: 'Words', icon: '🔤' },
  { id: 'voice', label: 'Voice', icon: '🎙️' },
];

/** The machinery, at the bottom: visited rarely, never during a sentence. */
const SYSTEM_VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'diagnostics', label: 'Checks', icon: '🩺' },
];

const selectEmergency = (state: AppState): boolean => state.emergencyOverride;
const selectEditMode = (state: AppState): boolean => state.editMode;

/**
 * One glance at the Checks button answers "is everything working?": a green
 * check when it is, an hourglass while engines load, a red cross for a hard
 * failure — an engine error, a failed compliance rule, or a blocked mic.
 */
const selectHealth = (state: AppState): 'ok' | 'loading' | 'error' => {
  const statuses = [state.asr.status, state.tts.status];
  const failed =
    statuses.includes('error') ||
    statuses.includes('unavailable') ||
    state.speakerModel.status === 'error' ||
    state.micPermission === 'denied' ||
    state.compliance.some((rule) => !rule.satisfied);
  if (failed) return 'error';
  if (statuses.includes('loading') || state.speakerModel.status === 'loading') return 'loading';
  return 'ok';
};

const HEALTH_ICONS = { ok: '✅', loading: '⏳', error: '❌' } as const;

function SpineItem({
  candidate,
  view,
  onSelect,
}: {
  candidate: { id: View; label: string; icon: string };
  view: View;
  onSelect: (view: View) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="spine__item"
      aria-current={view === candidate.id ? 'page' : undefined}
      onClick={() => onSelect(candidate.id)}
    >
      <span className="spine__icon" aria-hidden="true">
        {candidate.icon}
      </span>
      <span className="spine__label">{candidate.label}</span>
    </button>
  );
}

export function App({ chatGPTIdentity }: { chatGPTIdentity?: ChatGPTIdentity | null } = {}): JSX.Element {
  const [view, setView] = useState<View>('core');
  const settings = useStore(selectSettings);
  const emergency = useStore(selectEmergency);
  const editMode = useStore(selectEditMode);
  const health = useStore(selectHealth);

  // Tools must be registered from a component so their lifetime is bound to the
  // React tree — that is what guarantees the AbortController teardown runs.
  useAacWebMcpTools();

  useEffect(() => {
    actions.loadVocab();
    void session.start();
    return () => {
      void session.dispose();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.highContrast) root.setAttribute('data-contrast', 'high');
    else root.removeAttribute('data-contrast');
    // Always the larger size: this device's users are exactly who it is for.
    root.setAttribute('data-text-size', 'large');
  }, [settings.highContrast]);

  return (
    <div className={`app${emergency ? ' app--emergency' : ''}${editMode ? ' app--editing' : ''}`}>
      <a className="skip-link" href="#compose">
        Skip to the message box
      </a>

      {/* The generative surface owns the screen. The ribbon holds the message
          being built and the Speak button; the board below is the user's
          fixed motor plan. Machine suggestions arrive as a floating overlay —
          no reserved row, no reflow. The transcript lives behind the Listen
          view — useful, passive, and no longer the landlord of the layout. */}
      <OutputRibbon />
      <ChatGPTAuthButton identity={chatGPTIdentity ?? null} />

      <div className="app__main">
        {/* The conversation always sits to the LEFT of the spine, so the
            spine reads as the barrier between the passive transcript and the
            generative board. */}
        <div className="app__context">
          <TranscriptLog />
        </div>

        <nav className="spine" aria-label="Boards, emergency and panels">
          <div className="spine__nav" data-scan="">
            {BOARD_VIEWS.map((candidate) => (
              <SpineItem key={candidate.id} candidate={candidate} view={view} onSelect={setView} />
            ))}
          </div>

          {/* Mid-spine, equally reachable from the boards above and the
              machinery below; present in every view. */}
          <EmergencyBar />

          <div className="spine__nav spine__nav--system" data-scan="">
            {SYSTEM_VIEWS.map((candidate) => (
              <SpineItem
                key={candidate.id}
                candidate={
                  candidate.id === 'diagnostics'
                    ? { ...candidate, icon: HEALTH_ICONS[health] }
                    : candidate
                }
                view={view}
                onSelect={setView}
              />
            ))}
          </div>
        </nav>

        <main className="app__view">
          {view === 'core' && <CoreBoard />}
          {view === 'fringe' && <FringeBoard />}
          {view === 'phrases' && <PhraseBoard />}
          {view === 'voice' && (
            <section className="card">
              <VoicePanel />
            </section>
          )}
          {view === 'settings' && (
            <section className="card">
              <SettingsPanel />
            </section>
          )}
          {view === 'diagnostics' && (
            <section className="card">
              <VerificationPanel />
            </section>
          )}
        </main>
      </div>

      {/* Floating, self-hiding: renders only while there is something
          machine-suggested to show, over the board rather than in a row of
          its own, so the layout never reserves space for it. */}
      <SuggestionStrip />

      <NoticeStack />

      {/* A visual siren for the room: when the override is on, the whole
          perimeter pulses red so a caregiver sees the alert even when they
          cannot hear it. Purely presentational — never focusable. */}
      {emergency && <div className="emergency-flash" aria-hidden="true" />}

      {/* Caregiver editing: unmistakably not communication mode. A hatched
          frame around everything, and one obvious way out. */}
      {editMode && (
        <>
          <div className="edit-frame" aria-hidden="true" />
          <button
            type="button"
            className="button button--primary edit-done"
            onClick={() => actions.setEditMode(false)}
          >
            Done editing — back to talking
          </button>
        </>
      )}
    </div>
  );
}
