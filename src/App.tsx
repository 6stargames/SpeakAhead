import { useEffect, useMemo, useState, type JSX } from 'react';
import type { ChatGPTIdentity } from '@/auth/chatgpt';
import { ChatGPTAuthButton } from '@/components/ChatGPTAuthButton';
import { AssistTasksPanel } from '@/components/AssistTasksPanel';
import { ProfilePanel } from '@/components/ProfilePanel';
import { NEW_CALL_THEME_ITEM } from '@/components/CallCorner';
import { CoreBoard, CORE_THEME_ITEMS } from '@/components/CoreBoard';
import { EmergencyBar } from '@/components/EmergencyBar';
import { FringeBoard } from '@/components/FringeBoard';
import { NoticeStack } from '@/components/NoticeStack';
import { OutputRibbon } from '@/components/OutputRibbon';
import { PhraseBoard, PHRASE_THEME_ITEMS } from '@/components/PhraseBoard';
import {
  GENDER_AWARE_SETTINGS_THEME_ITEMS,
  SettingsPanel,
  THEME_PREVIEW_PRELOADS,
  VOICE_GENDER_THEME_ITEMS,
} from '@/components/SettingsPanel';
import { SuggestionStrip } from '@/components/SuggestionStrip';
import { TranscriptLog } from '@/components/TranscriptLog';
import { VerificationPanel } from '@/components/VerificationPanel';
import { VoicePanel } from '@/components/VoicePanel';
import {
  voiceBadgeThemeItem,
  voiceChoicesForGender,
  voicePortraitThemeItem,
} from '@/speech/tts/voiceChoices';
import {
  CONTEXT_BANNER_THEME_ITEMS,
  CONTEXT_DIVIDER_THEME_ITEMS,
} from '@/components/ContextSuggestionRow';
import { CLOSE_CHAT_THEME_ITEM } from '@/components/ThemedCloseButton';
import { session } from '@/session/AacSession';
import { useContextAssist } from '@/assist/useContextAssist';
import {
  ASSIST_FEATURE_PANEL_THEME_ITEMS,
  ASSIST_FEATURE_THEME_ITEMS,
} from '@/assist/featurePresentation';
import {
  ThemedSymbol,
  themeTileFor,
  usePreloadedThemePreviews,
  usePreparedSymbolTheme,
  useThemedSymbols,
  type ThemeTile,
} from '@/assist/themeIcons';
import {
  actions,
  selectContextualPhrases,
  selectContextualWords,
  selectPreviousContextualPhrases,
  selectPreviousContextualWords,
  selectSettings,
  useStore,
  type AppState,
  type AssistFeature,
} from '@/state/store';
import { useAacWebMcpTools } from '@/webmcp/tools';

/**
 * The board area shows exactly one of these; the spine switches between
 * them. The conversation is not a view any more - it is always on screen,
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

const SPINE_THEME_ITEMS = [...BOARD_VIEWS, ...SYSTEM_VIEWS].map(({ label, icon }) => ({
  text: label,
  symbol: icon,
  presentation: 'control-icon' as const,
}));
const SPINE_THEME_ITEM_BY_LABEL = new Map(
  SPINE_THEME_ITEMS.map((item) => [item.text, item] as const),
);
const INTERFACE_THEME_ITEMS = [
  ...SPINE_THEME_ITEMS,
  ...ASSIST_FEATURE_THEME_ITEMS,
  NEW_CALL_THEME_ITEM,
];

const selectEmergency = (state: AppState): boolean => state.emergencyOverride;
const selectEditMode = (state: AppState): boolean => state.editMode;
const selectFavorites = (state: AppState) => state.favorites;

/**
 * One glance at the Checks button answers "is everything working?": a green
 * check when it is, an hourglass while engines load, a red cross for a hard
 * failure - an engine error, a failed compliance rule, or a blocked mic.
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
  tile,
}: {
  candidate: { id: View; label: string; icon: string };
  view: View;
  onSelect: (view: View) => void;
  tile?: ThemeTile;
}): JSX.Element {
  return (
    <button
      type="button"
      className="spine__item"
      aria-current={view === candidate.id ? 'page' : undefined}
      onClick={() => onSelect(candidate.id)}
    >
      <span className="spine__icon" aria-hidden="true">
        <ThemedSymbol symbol={candidate.icon} tile={tile} />
      </span>
      <span className="spine__label">{candidate.label}</span>
    </button>
  );
}

export function App({ chatGPTIdentity }: { chatGPTIdentity?: ChatGPTIdentity | null } = {}): JSX.Element {
  const [view, setView] = useState<View>('core');
  const [contextPanel, setContextPanel] = useState<AssistFeature | 'profile' | null>(null);
  const settings = useStore(selectSettings);
  const emergency = useStore(selectEmergency);
  const editMode = useStore(selectEditMode);
  const health = useStore(selectHealth);
  const favorites = useStore(selectFavorites);
  const contextualWords = useStore(selectContextualWords);
  const contextualPhrases = useStore(selectContextualPhrases);
  const previousContextualWords = useStore(selectPreviousContextualWords);
  const previousContextualPhrases = useStore(selectPreviousContextualPhrases);
  const signedIn = Boolean(chatGPTIdentity?.displayName);
  const contextAssistEnabled = signedIn;
  const requestedSymbolTheme = signedIn ? settings.symbolTheme : 'emoji';
  const visibleVoiceChoices = useMemo(
    () => voiceChoicesForGender(settings.voiceGender, signedIn),
    [settings.voiceGender, signedIn],
  );
  const visibleVoicePortraitItems = useMemo(
    () => visibleVoiceChoices.map(voicePortraitThemeItem),
    [visibleVoiceChoices],
  );
  const visibleVoiceBadgeItems = useMemo(
    () => visibleVoiceChoices.map(voiceBadgeThemeItem),
    [visibleVoiceChoices],
  );
  const themePreparationGroups = useMemo(() => [
    // Functional icons are separate 1x1 images. Generated sprite sheets can
    // bleed across cells and make a control look like two unrelated pictures.
    { items: INTERFACE_THEME_ITEMS, batchSize: 1, singleSubject: true, genderAware: true },
    {
      items: [
        CLOSE_CHAT_THEME_ITEM,
        ...Object.values(CONTEXT_BANNER_THEME_ITEMS),
        ...Object.values(CONTEXT_DIVIDER_THEME_ITEMS),
        ...ASSIST_FEATURE_PANEL_THEME_ITEMS,
      ],
      batchSize: 1,
      singleSubject: true,
      genderAware: true,
    },
    { items: visibleVoicePortraitItems, batchSize: 3, singleSubject: true },
    { items: visibleVoiceBadgeItems, batchSize: 1, singleSubject: true },
    // These three choices depict their own explicit genders. Keep one stable
    // mixed set instead of recolouring all three when the selection changes.
    {
      items: VOICE_GENDER_THEME_ITEMS,
      batchSize: 3,
      singleSubject: true,
      genderAware: false,
    },
    {
      items: GENDER_AWARE_SETTINGS_THEME_ITEMS,
      batchSize: 9,
      singleSubject: true,
      genderAware: true,
    },
    { items: CORE_THEME_ITEMS },
    { items: PHRASE_THEME_ITEMS },
    { items: favorites },
    { items: contextualWords },
    { items: contextualPhrases },
    { items: previousContextualWords },
    { items: previousContextualPhrases },
  ], [
    contextualPhrases,
    contextualWords,
    favorites,
    previousContextualPhrases,
    previousContextualWords,
    visibleVoiceBadgeItems,
    visibleVoicePortraitItems,
  ]);
  const symbolTheme = usePreparedSymbolTheme(requestedSymbolTheme, themePreparationGroups);
  const interfaceSymbols = useThemedSymbols(INTERFACE_THEME_ITEMS, symbolTheme, {
    batchSize: 1,
    singleSubject: true,
    genderAware: true,
  });
  // Theme previews have their own art direction. Warm every choice while the
  // main board is open so neither Settings nor View more visibly starts work.
  usePreloadedThemePreviews(THEME_PREVIEW_PRELOADS, signedIn);

  // Tools must be registered from a component so their lifetime is bound to the
  // React tree - that is what guarantees the AbortController teardown runs.
  useAacWebMcpTools();
  useContextAssist(signedIn);

  useEffect(() => {
    actions.loadVocab();
    void session.start();
    return () => {
      void session.dispose();
    };
  }, []);

  useEffect(() => {
    session.setAccurateTranscriptionEnabled(signedIn);
    return () => session.setAccurateTranscriptionEnabled(false);
  }, [signedIn]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.highContrast) root.setAttribute('data-contrast', 'high');
    else root.removeAttribute('data-contrast');
    // Always the larger size: this device's users are exactly who it is for.
    root.setAttribute('data-text-size', 'large');
  }, [settings.highContrast]);

  useEffect(() => {
    if (!signedIn) setContextPanel(null);
  }, [signedIn]);

  const selectedAssistFeature = contextPanel === 'profile' ? null : contextPanel;

  return (
    <div className={`app${emergency ? ' app--emergency' : ''}${editMode ? ' app--editing' : ''}`}>
      <a className="skip-link" href="#compose">
        Skip to the message box
      </a>

      {/* The generative surface owns the screen. The ribbon holds the message
          being built and the Speak button; the board below is the user's
          motor plan. Context choices live in the first row of their matching
          board. The transcript remains visible beside it. */}
      <OutputRibbon
        leading={(
          <ChatGPTAuthButton
            identity={chatGPTIdentity ?? null}
            featureTiles={interfaceSymbols}
            selectedFeature={selectedAssistFeature}
            profileSelected={contextPanel === 'profile'}
            onProfileSelect={() => setContextPanel((current) => current === 'profile' ? null : 'profile')}
            onFeatureSelect={(feature) => setContextPanel((current) => current === feature ? null : feature)}
          />
        )}
      />

      <div className="app__main">
        {/* The conversation always sits to the LEFT of the spine, so the
            spine reads as the barrier between the passive transcript and the
            generative board. */}
        <div className="app__context">
          {contextPanel === 'profile' && chatGPTIdentity && !('signInPath' in chatGPTIdentity) ? (
            <ProfilePanel
              identity={chatGPTIdentity}
              onClose={() => setContextPanel(null)}
              symbolTheme={symbolTheme}
            />
          ) : selectedAssistFeature ? (
            <AssistTasksPanel
              selectedFeature={selectedAssistFeature}
              onClose={() => setContextPanel(null)}
              symbolTheme={symbolTheme}
            />
          ) : (
            <TranscriptLog symbolTheme={symbolTheme} />
          )}
        </div>

        <nav className="spine" aria-label="Boards, emergency and panels">
          <div className="spine__nav" data-scan="">
            {BOARD_VIEWS.map((candidate) => (
              <SpineItem
                key={candidate.id}
                candidate={candidate}
                view={view}
                onSelect={setView}
                tile={themeTileFor(interfaceSymbols, SPINE_THEME_ITEM_BY_LABEL.get(candidate.label)!)}
              />
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
                tile={themeTileFor(interfaceSymbols, SPINE_THEME_ITEM_BY_LABEL.get(candidate.label)!)}
              />
            ))}
          </div>
        </nav>

        <main className="app__view">
          {view === 'core' && (
            <CoreBoard
              contextAssistEnabled={contextAssistEnabled}
              symbolTheme={symbolTheme}
            />
          )}
          {view === 'fringe' && <FringeBoard symbolTheme={symbolTheme} />}
          {view === 'phrases' && (
            <PhraseBoard
              contextAssistEnabled={contextAssistEnabled}
              symbolTheme={symbolTheme}
            />
          )}
          {view === 'voice' && (
            <section className="card">
              <VoicePanel />
            </section>
          )}
          {view === 'settings' && (
            <section className="card">
              <SettingsPanel signedIn={signedIn} symbolTheme={symbolTheme} />
            </section>
          )}
          {view === 'diagnostics' && (
            <section className="card">
              <VerificationPanel />
            </section>
          )}
        </main>
      </div>

      {/* Only staged agent text, microphone problems, and the older prediction
          ladder use this self-hiding overlay. AI words and phrases never do. */}
      <SuggestionStrip />

      <NoticeStack />

      {/* A visual siren for the room: when the override is on, the whole
          perimeter pulses red so a caregiver sees the alert even when they
          cannot hear it. Purely presentational - never focusable. */}
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
            Done editing - back to talking
          </button>
        </>
      )}
    </div>
  );
}
