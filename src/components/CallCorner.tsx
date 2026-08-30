import { useEffect, useState, type JSX } from 'react';
import { ThemedSymbol, themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import { session } from '@/session/AacSession';
import { actions, useStore, type AppState, type SymbolTheme } from '@/state/store';

export const NEW_CALL_THEME_ITEM = { text: 'New call', symbol: '📞' } as const;

const selectCall = (state: AppState) => ({
  call: state.call,
  roomCode: state.roomCode,
});

/** Exactly the shape createRoomCode() produces: XXXX-XXXX, unambiguous alphabet. */
const ROOM_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

function formatElapsed(since: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Calling, from the corner of the chat it belongs to.
 *
 * Idle: a code field and one button — blank creates a room, a typed code
 * joins one. Creating copies the code straight to the clipboard (with a
 * toast), because the very next thing anyone does with a new room code is
 * send it to the other person. In a call: the code with a copy button, how
 * long the call has been running, and the way out.
 */
export function CallCorner({ symbolTheme = 'emoji' }: { symbolTheme?: SymbolTheme }): JSX.Element {
  const state = useStore(selectCall);
  const callTiles = useThemedSymbols([NEW_CALL_THEME_ITEM], symbolTheme, {
    batchSize: 1,
    singleSubject: true,
  });
  const [code, setCode] = useState('');
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const inCall = state.call !== 'idle' && state.call !== 'closed';
  const connected = state.call === 'connected';

  // The room code shows long enough to be shared, then tucks itself away —
  // it is a secret, and mid-call it is only noise. Hovering the corner
  // brings it back.
  const [codeFresh, setCodeFresh] = useState(true);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!inCall) {
      setCodeFresh(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setCodeFresh(false), 6000);
    return () => window.clearTimeout(timer);
  }, [inCall]);
  const codeVisible = codeFresh || hovered;

  // The call clock: starts when the call connects, ticks once a second.
  useEffect(() => {
    if (!connected) {
      if (!inCall) setConnectedAt(null);
      return undefined;
    }
    setConnectedAt((previous) => previous ?? Date.now());
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, [connected, inCall]);

  // A room code sitting in the clipboard was almost certainly just sent to
  // this person — put it in the field so joining is one press. Never while in
  // a call, never over something already typed, and never this device's own
  // last code (creating a call copies it, and it must not resurface after).
  useEffect(() => {
    if (inCall) return undefined;
    let cancelled = false;
    const prefill = async (): Promise<void> => {
      if (!navigator.clipboard?.readText || !document.hasFocus()) return;
      try {
        const text = (await navigator.clipboard.readText()).trim().toUpperCase();
        if (cancelled || !ROOM_CODE_PATTERN.test(text) || text === state.roomCode) return;
        setCode((current) => current || text);
      } catch {
        /* Clipboard denied or unavailable: typing remains the way in. */
      }
    };
    void prefill();
    const onFocus = (): void => void prefill();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [inCall, state.roomCode]);

  const copyCode = async (room: string, announce: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(room);
      actions.notify('info', announce);
    } catch {
      // Clipboard needs a secure context and permission; the code on screen
      // is the fallback.
      actions.notify('info', `Room code: ${room}`);
    }
  };

  const start = async (): Promise<void> => {
    const typed = code.trim().toUpperCase();
    const creating = typed.length === 0;
    const room = await session.joinCall(typed || undefined);
    setCode('');
    if (creating) {
      await copyCode(room, `Room code ${room} copied to clipboard — send it to the other person.`);
    }
  };

  if (!inCall) {
    return (
      <div className="call-corner" data-scan="">
        <input
          type="text"
          className="call-corner__input"
          aria-label="Room code — leave blank to create a new call"
          placeholder="Code"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        <button type="button" className="button button--primary" onClick={() => void start()}>
          {code.trim() ? 'Join' : (
            <>
              <span className="call-corner__button-icon" aria-hidden="true">
                <ThemedSymbol
                  symbol={NEW_CALL_THEME_ITEM.symbol}
                  tile={themeTileFor(callTiles, NEW_CALL_THEME_ITEM)}
                />
              </span>
              <span>New call</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className="call-corner call-corner--active"
      data-scan=""
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <span className="call-corner__status" role="status">
        {connected && connectedAt !== null ? `📞 ${formatElapsed(connectedAt)}` : `📞 ${state.call}…`}
      </span>
      {codeVisible && <code className="call-corner__code">{state.roomCode}</code>}
      <button
        type="button"
        className="button button--ghost"
        title="Copy the room code"
        onClick={() => void copyCode(state.roomCode, `Room code ${state.roomCode} copied to clipboard.`)}
      >
        ⧉
      </button>
      <button type="button" className="button button--danger" onClick={() => session.hangUp()}>
        End
      </button>
    </div>
  );
}
