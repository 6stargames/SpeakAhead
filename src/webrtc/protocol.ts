/**
 * Wire formats for signalling and for the Real-Time Text data channel.
 *
 * Kept in one file, free of runtime dependencies, so the Node signalling server
 * and the browser client cannot drift apart.
 */

// ---------------------------------------------------------------------------
// Signalling (WebSocket)
// ---------------------------------------------------------------------------

export interface SignalDescription {
  readonly kind: 'description';
  readonly description: RTCSessionDescriptionInit;
}

export interface SignalCandidate {
  readonly kind: 'candidate';
  readonly candidate: RTCIceCandidateInit | null;
}

export type SignalPayload = SignalDescription | SignalCandidate;

export type ClientToServer =
  | { t: 'join'; room: string; peerId: string }
  | { t: 'leave' }
  | { t: 'signal'; to: string; payload: SignalPayload }
  | { t: 'ping' };

export type ServerToClient =
  | { t: 'joined'; room: string; peerId: string; peers: string[] }
  | { t: 'peer-joined'; peerId: string }
  | { t: 'peer-left'; peerId: string }
  | { t: 'signal'; from: string; payload: SignalPayload }
  | { t: 'error'; message: string }
  | { t: 'pong' };

// ---------------------------------------------------------------------------
// Real-Time Text (RTCDataChannel)
// ---------------------------------------------------------------------------

/**
 * RAUR User Need 13 - deaf and deaf-blind users must be able to tell incoming
 * text from outgoing text. Every message therefore carries a stable `id` so the
 * receiving interface can update an in-progress line in place and attribute it
 * to a source, rather than appending an unattributed stream of fragments.
 */
export interface RttMessage {
  readonly t: 'rtt';
  readonly id: string;
  readonly text: string;
  readonly final: boolean;
  readonly seq: number;
  readonly sentAt: number;
}

export interface PeerHello {
  readonly t: 'hello';
  readonly displayName: string;
  readonly capabilities: {
    readonly synthesisRoutable: boolean;
    readonly recognitionOffline: boolean;
  };
}

/** Broadcast so the peer knows the user has escalated (RAUR Need 11). */
export interface PeerStateMessage {
  readonly t: 'state';
  readonly emergencyOverride: boolean;
  readonly composing: boolean;
}

export type DataChannelMessage = RttMessage | PeerHello | PeerStateMessage;

export const RTT_CHANNEL_LABEL = 'aac-rtt';

export function isDataChannelMessage(value: unknown): value is DataChannelMessage {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return t === 'rtt' || t === 'hello' || t === 'state';
}

export function isServerToClient(value: unknown): value is ServerToClient {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return (
    t === 'joined' || t === 'peer-joined' || t === 'peer-left' || t === 'signal' || t === 'error' || t === 'pong'
  );
}
