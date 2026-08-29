import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { formatLoadPercent } from '@/lib/progress';
import { alignWordsToText } from '@/speech/confidence';
import { session } from '@/session/AacSession';
import { actions, selectTurns, useStore, type AppState, type Turn } from '@/state/store';
import type { SpeakerProfile } from '@/speech/speakers';
import { CallCorner } from './CallCorner';
import { LoadProgress } from './LoadProgress';
import { Waveform } from './Waveform';

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Whose words these are.
 *
 * Anything the device said on the user's behalf is theirs. Dictation is theirs
 * only while it came from the voice identified as the owner's — someone who
 * walks into the room and speaks is not the user, and rendering their words as
 * the user's own is what made the transcript misleading.
 */
function attribute(
  turn: Turn,
  speakers: readonly SpeakerProfile[],
  liveSpeaker: AppState['liveSpeaker'],
): { mine: boolean; who: string; speakerId?: string } {
  if (turn.source === 'peer') return { mine: false, who: 'Partner' };

  // Anything the device said on the user's behalf is unambiguously theirs.
  if (!turn.dictated) return { mine: true, who: 'You' };

  const speaker = turn.speakerId ? speakers.find((candidate) => candidate.id === turn.speakerId) : undefined;
  if (speaker) return { mine: speaker.isOwner, who: speaker.label, speakerId: speaker.id };

  // Still being spoken: use the running guess so the bubble is attributed as it
  // forms rather than jumping sides when the turn finally ends.
  if (!turn.final && liveSpeaker) return { mine: liveSpeaker.isOwner, who: liveSpeaker.label };

  // Heard, but not identified. Defaulting to the user was how a stranger's
  // sentence ended up rendered as something they had said: every failure to
  // identify a voice silently became a blue bubble. An honest "unidentified"
  // is worse to look at and far better to be.
  return { mine: false, who: 'Unidentified voice' };
}

/**
 * The junk-turn policy (Task 03 of the round-two brief).
 *
 * Pitch separation in a noisy room commits fragments — "Ta.", "E budding." —
 * as permanent conversation. A dictated turn this short is far more often
 * noise than speech, so it renders collapsed: still present, still honest,
 * but visually subordinate so real conversation is what the eye finds.
 * Turns typed or spoken deliberately are never collapsed.
 */
function isLowContent(turn: Turn): boolean {
  if (!turn.final || !turn.dictated) return false;
  const text = turn.text.trim();
  return text.length <= 16 && text.split(/\s+/).length <= 2;
}

/**
 * In-place speaker repair: rename, claim, or forget a voice from the label
 * where the misattribution is visible, rather than a Settings page away.
 */
function SpeakerMenu({ speaker, onClose }: { speaker: SpeakerProfile; onClose: () => void }): JSX.Element {
  return (
    <div className="speaker-menu" role="group" aria-label={`Fix the voice “${speaker.label}”`}>
      <label className="visually-hidden" htmlFor={`fix-${speaker.id}`}>
        Name for this voice
      </label>
      <input
        id={`fix-${speaker.id}`}
        type="text"
        defaultValue={speaker.label}
        onBlur={(event) => session.renameSpeaker(speaker.id, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            session.renameSpeaker(speaker.id, (event.target as HTMLInputElement).value);
            onClose();
          }
        }}
      />
      <button
        type="button"
        className="button"
        disabled={speaker.isOwner}
        onClick={() => {
          session.markSpeakerAsOwner(speaker.id);
          onClose();
        }}
        title="Words from this voice appear as yours"
      >
        {speaker.isOwner ? 'This is you' : 'This is me'}
      </button>
      <button
        type="button"
        className="button button--ghost"
        onClick={() => {
          session.forgetSpeaker(speaker.id);
          onClose();
        }}
        title="Discard this voice so it is learned again from scratch. Merges a split voice."
      >
        Forget voice
      </button>
      <button type="button" className="button button--ghost" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/**
 * The turn's text, with words the recogniser was unsure of marked by a wavy
 * underline — the spell-check squiggle, but for hearing. Only final turns
 * carry confidences, and if the words cannot be aligned to the displayed
 * text exactly, nothing is marked: a squiggle under the wrong word would be
 * worse than none.
 */
function TurnText({ turn }: { turn: Turn }): JSX.Element {
  const aligned = turn.final ? alignWordsToText(turn.text, turn.words) : null;
  if (!aligned) return <>{turn.text}</>;
  return (
    <>
      {aligned.map((word, index) => (
        <Fragment key={index}>
          {index > 0 && ' '}
          {word.uncertain ? (
            <span className="turn__word--uncertain" title="The recogniser was not sure of this word.">
              {word.text}
            </span>
          ) : (
            word.text
          )}
        </Fragment>
      ))}
    </>
  );
}

function TurnRow({
  turn,
  speakers,
  liveSpeaker,
  menuOpen,
  onToggleMenu,
}: {
  turn: Turn;
  speakers: readonly SpeakerProfile[];
  liveSpeaker: AppState['liveSpeaker'];
  menuOpen: boolean;
  onToggleMenu: (id: string | null) => void;
}): JSX.Element {
  const { mine, who, speakerId } = attribute(turn, speakers, liveSpeaker);
  const speaker = speakerId ? speakers.find((candidate) => candidate.id === speakerId) : undefined;
  const lowContent = isLowContent(turn);
  // Dictated-but-unspoken words never reached the room. They render as an
  // outline, not a filled bubble: present, legible, and visually subordinate
  // to everything that was actually heard.
  const unspoken = mine && turn.dictated && turn.final;
  const classes = [
    'turn',
    mine ? 'turn--mine' : 'turn--other',
    turn.final ? '' : 'turn--interim',
    unspoken ? 'turn--unspoken' : '',
    lowContent ? 'turn--junk' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={classes}>
      <header className="turn__meta">
        {/* An explicit textual label, not only colour and position: RAUR Need 13
            has to hold for a screen-reader user and for a colour-blind one. */}
        {/* Dictated text was heard, not spoken aloud and not sent to anyone.
            Labelling both "You said" would misrepresent what happened. */}
        {speaker ? (
          <button
            type="button"
            className="turn__who"
            aria-expanded={menuOpen}
            title="Fix this voice: rename it, claim it, or forget it"
            onClick={() => onToggleMenu(menuOpen ? null : turn.id)}
          >
            {mine && turn.dictated ? 'You dictated' : `${who} said`} ✎
          </button>
        ) : (
          <span>{mine && turn.dictated ? 'You dictated' : `${who} said`}</span>
        )}
        <span aria-hidden="true">·</span>
        <span>{formatTime(turn.at)}</span>
        {turn.viaRtt && <span className="turn__badge">real-time text</span>}
        {unspoken && <span className="turn__badge">not spoken aloud</span>}
        {turn.originalText && (
          <button
            type="button"
            className="turn__badge turn__correction"
            title={`${turn.correctionReason ?? 'An uncertain word was corrected from context.'} Original: ${turn.originalText}`}
            onClick={() => actions.revertContextCorrection(turn.id)}
          >
            {turn.correctionSource === 'chatgpt' ? 'ChatGPT corrected' : 'context corrected'} · undo
          </button>
        )}
        {!turn.final && <span className="turn__badge">still speaking</span>}
      </header>
      <p className="turn__text">
        <TurnText turn={turn} />
      </p>
      {menuOpen && speaker && <SpeakerMenu speaker={speaker} onClose={() => onToggleMenu(null)} />}
    </article>
  );
}

const selectSpeakers = (state: AppState): SpeakerProfile[] => state.speakers;
const selectPendingVoices = (state: AppState): number => state.pendingVoices;
const selectCallInfo = (state: AppState) => ({
  call: state.call,
  peerName: state.peerName,
  rttReady: state.rttReady,
  roomCode: state.roomCode,
  callHost: state.callHost,
  peerEmergency: state.peerEmergency,
});
const selectLiveSpeaker = (state: AppState) => state.liveSpeaker;
const selectListening = (state: AppState) => ({
  micActive: state.micActive,
  micPermission: state.micPermission,
  asrReady: state.asr.status === 'ready',
  asrLoading: state.asr.status === 'loading',
  asrDetail: state.asr.detail,
  ttsStatus: state.tts.status,
  ttsDetail: state.tts.detail,
});

export function TranscriptLog(): JSX.Element {
  const turns = useStore(selectTurns);
  const speakers = useStore(selectSpeakers);
  const pendingVoices = useStore(selectPendingVoices);
  const liveSpeaker = useStore(selectLiveSpeaker);
  const listening = useStore(selectListening);
  const callInfo = useStore(selectCallInfo);
  const onCall = callInfo.call !== 'idle' && callInfo.call !== 'closed';
  const containerRef = useRef<HTMLDivElement>(null);
  const [openMenuTurn, setOpenMenuTurn] = useState<string | null>(null);
  /**
   * The furthest the list could scroll at the previous update.
   *
   * Following the conversation used to depend on a flag set by scroll events,
   * which is fragile: the flag is only ever as correct as the events, and a
   * browser that does not fire them leaves the transcript stuck at the top
   * while messages pile up below. Comparing the scroll position against the
   * previous maximum needs no events at all — if the reader was at the bottom
   * before this message arrived, follow; if they had scrolled back to re-read
   * something, leave them where they are.
   */
  const followIfAtTop = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    // Newest-first: new messages arrive at the top. A reader at (or near) the
    // top follows them; one who scrolled down to re-read something is left
    // exactly where they are.
    if (element.scrollTop <= 96) element.scrollTop = 0;
  }, []);

  // Layout effect: scroll before the browser paints, so the newest message is
  // simply there rather than appearing and then jumping into place.
  useLayoutEffect(followIfAtTop, [turns, followIfAtTop]);

  // Re-follow when the list changes size without the turns changing: a window
  // resize, a font finishing loading, the composer growing underneath it.
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver !== 'function') return undefined;

    const observer = new ResizeObserver(followIfAtTop);
    observer.observe(element);
    return () => observer.disconnect();
  }, [followIfAtTop]);

  const [voicesOpen, setVoicesOpen] = useState(false);

  // Newest at the top: the freshest words sit beside the listening bar, and
  // history sinks instead of scrolling out of reach.
  const newestFirst = [...turns].reverse();

  // How much each identified speaker has actually said, from the turns
  // attributed to them: words, characters, and voiced time (each analysis
  // frame is ~64ms of voiced audio).
  const speakerStats = speakers
    .map((speaker) => {
      let words = 0;
      let chars = 0;
      let frames = 0;
      for (const turn of turns) {
        if (!turn.final || turn.speakerId !== speaker.id) continue;
        words += turn.text.split(/\s+/).filter((word) => word.length > 0).length;
        chars += turn.text.length;
        frames += turn.voice?.frames ?? 0;
      }
      return { id: speaker.id, label: speaker.label, words, chars, seconds: frames * 0.064 };
    })
    .sort((a, b) => b.words - a.words);
  const totalWords = speakerStats.reduce((sum, speaker) => sum + speaker.words, 0);

  return (
    <section className="card" aria-labelledby="transcript-heading">
      <div className="panel transcript-header" style={{ paddingBottom: 0 }}>
        <h2 className="panel__title" id="transcript-heading">
          Chat
        </h2>
        {/* The two most talkative speakers, always in sight; everyone else is
            one press away on the chip. */}
        {speakerStats.length > 0 && totalWords > 0 && (
          <span className="voices-inline">
            {speakerStats.slice(0, 2).map((speaker) => (
              <span className="voices-inline__item" key={speaker.id}>
                <span className="voices-inline__name">{speaker.label}</span>{' '}
                <span className="voices-inline__share">
                  {Math.round((speaker.words / totalWords) * 100)}%
                </span>{' '}
                <span className="voices-inline__detail">
                  {speaker.words}w · {formatSeconds(speaker.seconds)}
                </span>
              </span>
            ))}
          </span>
        )}

        {/* Speakers with a name, and voices still earning one. Press for how
            much each speaker has actually said. */}
        {(speakers.length > 0 || pendingVoices > 0) && (
          <button
            type="button"
            className="chip voices-chip"
            aria-expanded={voicesOpen}
            aria-label={`${speakers.length} speaker${speakers.length === 1 ? '' : 's'}${
              pendingVoices > 0 ? `, ${pendingVoices} more forming` : ''
            }. Press for details.`}
            title="How much each speaker has said so far."
            onClick={() => setVoicesOpen((open) => !open)}
          >
            <span aria-hidden="true">👥</span>
            {speakers.length}
            {pendingVoices > 0 && <span className="voices-chip__forming"> +{pendingVoices}</span>}
          </button>
        )}
        {/* Who is on the call, beside who is in the room. */}
        {onCall && (
          <button
            type="button"
            className="chip voices-chip"
            aria-expanded={voicesOpen}
            title="Call details."
            onClick={() => setVoicesOpen((open) => !open)}
          >
            <span aria-hidden="true">📞</span>
            {/* Everyone on the call, you included: a connected 1:1 call is
                two people, and "1" read as something being missing. */}
            {callInfo.call === 'connected' ? '2' : callInfo.call}
          </button>
        )}

        {voicesOpen && (
          <div className="voices-panel card" role="region" aria-label="Speaker activity">
            {speakerStats.length === 0 && <p className="voices-panel__empty">Nobody identified yet.</p>}
            {speakerStats.map((speaker) => (
              <div className="voices-panel__row" key={speaker.id}>
                <span className="voices-panel__name">{speaker.label}</span>
                <span className="voices-panel__share">
                  {totalWords > 0 ? Math.round((speaker.words / totalWords) * 100) : 0}%
                </span>
                <span className="voices-panel__detail">
                  {speaker.words} words · {speaker.chars} chars · {formatSeconds(speaker.seconds)}
                </span>
              </div>
            ))}
            {pendingVoices > 0 && (
              <p className="voices-panel__forming">
                {pendingVoices} more voice{pendingVoices === 1 ? '' : 's'} heard — gathering enough
                speech to name {pendingVoices === 1 ? 'it' : 'them'}.
              </p>
            )}
            {onCall && (
              <>
                {/* Both ends of the call, so the list agrees with the "2" on
                    the chip: the other person, then this device. */}
                <div className="voices-panel__row voices-panel__row--call">
                  <span className="voices-panel__name">
                    <span aria-hidden="true">📞</span> {callInfo.peerName ?? 'Partner'}
                  </span>
                  <span className="voices-panel__detail">
                    {callInfo.call} · real-time text {callInfo.rttReady ? 'open' : 'not open'} · room{' '}
                    {callInfo.roomCode}
                    {callInfo.peerEmergency ? ' · EMERGENCY OVERRIDE ON' : ''}
                  </span>
                </div>
                <div className="voices-panel__row voices-panel__row--call">
                  <span className="voices-panel__name">
                    <span aria-hidden="true">📞</span> {callInfo.callHost ? 'Host (me)' : 'Guest (me)'}
                  </span>
                  <span className="voices-panel__detail">this device</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* The microphone's state, directly under the title and above the
          newest words — always present, because an ear that silently is not
          working looks identical to one that is. Before permission exists it
          says what one tap will do; Chrome's quiet permission UI suppresses
          non-gesture prompts, so the first tap is what actually asks. */}
      {listening.micActive ? (
        <div className="listening-bar" role="status" aria-live="polite">
          <span className="listening-bar__label">
            {!listening.asrReady
              ? 'Getting ready'
              : liveSpeaker
                ? `Listening · ${liveSpeaker.label}`
                : 'Listening'}
          </span>
          {!listening.asrReady ? (
            <LoadProgress percent={formatLoadPercent(listening.asrDetail)} />
          ) : (
            <Waveform active={listening.micActive} />
          )}
        </div>
      ) : (
        <div className="listening-bar listening-bar--off" role="status">
          <span className="listening-bar__label">
            {listening.micPermission === 'denied' ? 'Microphone blocked' : 'Microphone off'}
          </span>
          <span className="listening-bar__preview" style={{ maxWidth: 'none' }}>
            {listening.micPermission === 'denied'
              ? 'Allow the microphone in the address bar, then reload.'
              : 'Tap or press anywhere to start listening.'}
          </span>
        </div>
      )}

      {/* The voice loading gets the same visibility as the ears: until it is
          ready, pressing Speak would do nothing, and that must never be a
          surprise. */}
      {listening.ttsStatus === 'loading' && (
        <div className="listening-bar" role="status" aria-live="polite">
          <span className="listening-bar__label">Voice getting ready</span>
          <LoadProgress percent={formatLoadPercent(listening.ttsDetail)} />
        </div>
      )}

      <div
        className="transcript"
        ref={containerRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Conversation transcript, newest first"
        tabIndex={0}
      >
        {newestFirst.length === 0 ? (
          listening.asrLoading || listening.ttsStatus === 'loading' ? (
            /* The load takes a while; the wait is the one moment someone is
               guaranteed to be reading, so it teaches instead of apologising. */
            <div className="transcript__empty transcript__intro">
              <p>
                <strong>Getting ready…</strong> while the voices load, here is how it works:
              </p>
              <p>
                Tap words on the board to build a message, then press <strong>Speak</strong> to say
                it aloud.
              </p>
              <p>
                <strong>⭐ Favs</strong> and <strong>💬 Phrases</strong> speak with a single tap.
              </p>
              <p>Just talk — everything the microphone hears appears here in the chat.</p>
              <p>
                To call someone, press <strong>📞 New call</strong> below and send them the code.
              </p>
            </div>
          ) : (
            <p className="transcript__empty">
              Nothing said yet. Type below and press <strong>Speak</strong>, or just talk — the
              microphone is always listening.
            </p>
          )
        ) : (
          newestFirst.map((turn) => (
            <TurnRow
              key={turn.id}
              turn={turn}
              speakers={speakers}
              liveSpeaker={liveSpeaker}
              menuOpen={openMenuTurn === turn.id}
              onToggleMenu={setOpenMenuTurn}
            />
          ))
        )}
      </div>

      {/* Calls live in the chat's corner: the conversation is where a call
          happens, not a separate page. */}
      <CallCorner />
    </section>
  );
}

function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}
