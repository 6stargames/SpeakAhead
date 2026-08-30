import { HttpSignalingClient } from './HttpSignalingClient';
import { SignalingClient, type SignalingEvents, type SignalingStatus } from './SignalingClient';
import type { ClientToServer, SignalPayload } from './protocol';

/** The surface `PeerSession` depends on, satisfied by either transport. */
export interface SignalingTransport {
  readonly events: { on<K extends keyof SignalingEvents>(event: K, listener: (payload: SignalingEvents[K]) => void): () => void };
  readonly status: SignalingStatus;
  readonly connected: boolean;
  connect(room: string, peerId: string): Promise<void>;
  send(message: ClientToServer): void;
  signal(to: string, payload: SignalPayload): void;
  close(): void;
}

/**
 * Choose a signalling transport from the configured endpoint.
 *
 * A `ws://` or `wss://` URL means a host that permits WebSocket upgrades - the
 * standalone regional deployment. Anything else, including the default empty
 * string, uses same-origin HTTP long-polling, because Firebase App Hosting's
 * edge refuses upgrades outright: it answers a valid handshake with 403 before
 * the request reaches the container.
 */
export function createSignalingClient(endpoint: string): SignalingTransport {
  if (/^wss?:\/\//i.test(endpoint)) return new SignalingClient(endpoint);
  return new HttpSignalingClient(endpoint);
}
