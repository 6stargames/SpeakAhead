import { Emitter } from '@/lib/events';
import { isServerToClient, type ClientToServer, type ServerToClient, type SignalPayload } from './protocol';

export type SignalingStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

export interface SignalingEvents extends Record<string, unknown> {
  status: SignalingStatus;
  joined: { room: string; peerId: string; peers: string[] };
  'peer-joined': { peerId: string };
  'peer-left': { peerId: string };
  signal: { from: string; payload: SignalPayload };
  error: Error;
}

const HEARTBEAT_MS = 25_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * WebSocket signalling client with exponential backoff.
 *
 * Institutional networks - the hospitals and school districts this device is
 * built for - drop idle WebSockets aggressively, so the heartbeat is not
 * optional and reconnection has to be automatic and quiet.
 */
export class SignalingClient {
  readonly events = new Emitter<SignalingEvents>();

  #url: string;
  #socket: WebSocket | null = null;
  #status: SignalingStatus = 'idle';
  #room: string | null = null;
  #peerId: string | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;
  #closedByUser = false;

  constructor(url: string) {
    this.#url = url;
  }

  get status(): SignalingStatus {
    return this.#status;
  }

  get connected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  connect(room: string, peerId: string): Promise<void> {
    this.#room = room;
    this.#peerId = peerId;
    this.#closedByUser = false;
    return this.#open();
  }

  send(message: ClientToServer): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify(message));
  }

  signal(to: string, payload: SignalPayload): void {
    this.send({ t: 'signal', to, payload });
  }

  close(): void {
    this.#closedByUser = true;
    this.#clearTimers();
    if (this.#socket && this.#socket.readyState === WebSocket.OPEN) {
      this.send({ t: 'leave' });
    }
    this.#socket?.close();
    this.#socket = null;
    this.#setStatus('closed');
  }

  // -------------------------------------------------------------------------

  #open(): Promise<void> {
    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');

    return new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.#url);
      } catch (error) {
        this.#setStatus('error');
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      this.#socket = socket;
      let settled = false;

      socket.onopen = () => {
        this.#attempt = 0;
        this.#setStatus('connected');
        if (this.#room && this.#peerId) {
          this.send({ t: 'join', room: this.#room, peerId: this.#peerId });
        }
        this.#startHeartbeat();
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      socket.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!isServerToClient(parsed)) return;
        this.#dispatch(parsed);
      };

      socket.onerror = () => {
        // The close handler carries the actionable information; avoid emitting
        // a second, less useful error for the same failure.
        if (!settled) {
          settled = true;
          reject(new Error(`Could not reach the signalling server at ${this.#url}.`));
        }
      };

      socket.onclose = () => {
        this.#clearTimers();
        this.#socket = null;
        if (this.#closedByUser) {
          this.#setStatus('closed');
          return;
        }
        this.#scheduleReconnect();
      };
    });
  }

  #dispatch(message: ServerToClient): void {
    switch (message.t) {
      case 'joined':
        this.events.emit('joined', { room: message.room, peerId: message.peerId, peers: message.peers });
        break;
      case 'peer-joined':
        this.events.emit('peer-joined', { peerId: message.peerId });
        break;
      case 'peer-left':
        this.events.emit('peer-left', { peerId: message.peerId });
        break;
      case 'signal':
        this.events.emit('signal', { from: message.from, payload: message.payload });
        break;
      case 'error':
        this.events.emit('error', new Error(message.message));
        break;
      case 'pong':
        break;
    }
  }

  #scheduleReconnect(): void {
    this.#setStatus('reconnecting');
    this.#attempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** (this.#attempt - 1));
    this.#reconnectTimer = setTimeout(() => {
      void this.#open().catch(() => {
        /* The close handler will schedule the next attempt. */
      });
    }, delay);
  }

  #startHeartbeat(): void {
    this.#clearHeartbeat();
    this.#heartbeat = setInterval(() => this.send({ t: 'ping' }), HEARTBEAT_MS);
  }

  #clearHeartbeat(): void {
    if (this.#heartbeat) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
  }

  #clearTimers(): void {
    this.#clearHeartbeat();
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #setStatus(status: SignalingStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.events.emit('status', status);
  }
}
