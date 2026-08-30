import { Emitter } from '@/lib/events';
import type { ClientToServer, ServerToClient, SignalPayload } from './protocol';
import { isServerToClient } from './protocol';
import type { SignalingEvents, SignalingStatus } from './SignalingClient';

/**
 * Signalling over HTTP long-polling.
 *
 * The application origin cannot use WebSockets: Firebase App Hosting's edge
 * answers a valid handshake with 403 before the request reaches the container,
 * on every path. Plain HTTP passes through untouched.
 *
 * Long-polling rather than Server-Sent Events because every response completes
 * normally, so no proxy can buffer a stream and stall call setup. The extra
 * round trip per message costs nothing that matters - signalling only runs
 * during setup, and once the peer connection is established, media and
 * real-time text flow directly between the browsers with no server involved.
 *
 * Presents the same surface as `SignalingClient`, so `PeerSession` neither
 * knows nor cares which transport it has.
 */
export class HttpSignalingClient {
  readonly events = new Emitter<SignalingEvents>();

  #base: string;
  #room: string | null = null;
  #peerId: string | null = null;
  #status: SignalingStatus = 'idle';
  #closed = false;
  #abort: AbortController | null = null;
  #attempt = 0;

  /**
   * @param base Origin serving the endpoints. Empty string means same-origin,
   *   which is the normal case and avoids any CORS involvement.
   */
  constructor(base = '') {
    this.#base = base.replace(/\/+$/, '');
  }

  get status(): SignalingStatus {
    return this.#status;
  }

  get connected(): boolean {
    return this.#status === 'connected';
  }

  async connect(room: string, peerId: string): Promise<void> {
    this.#room = room;
    this.#peerId = peerId;
    this.#closed = false;
    this.#attempt = 0;

    this.#setStatus('connecting');
    await this.#join();
    void this.#pollLoop();
  }

  send(message: ClientToServer): void {
    switch (message.t) {
      case 'signal':
        void this.#post('send', {
          room: this.#room,
          from: this.#peerId,
          to: message.to,
          payload: message.payload,
        });
        break;
      case 'leave':
        void this.#post('leave', { room: this.#room, peerId: this.#peerId });
        break;
      case 'join':
        void this.#join();
        break;
      case 'ping':
        // The poll itself is the keepalive; there is nothing to ping.
        break;
    }
  }

  signal(to: string, payload: SignalPayload): void {
    this.send({ t: 'signal', to, payload });
  }

  close(): void {
    this.#closed = true;
    this.#abort?.abort();
    this.#abort = null;
    if (this.#room && this.#peerId) {
      void this.#post('leave', { room: this.#room, peerId: this.#peerId });
    }
    this.#setStatus('closed');
  }

  // -------------------------------------------------------------------------

  async #join(): Promise<void> {
    if (!this.#room || !this.#peerId) return;

    try {
      const result = await this.#post('join', { room: this.#room, peerId: this.#peerId });
      if (!result || result.ok === false) {
        this.events.emit('error', new Error(String(result?.error ?? 'Could not join the room.')));
        this.#setStatus('error');
        return;
      }

      this.#attempt = 0;
      this.#setStatus('connected');
      this.events.emit('joined', {
        room: String(result.room ?? this.#room),
        peerId: this.#peerId,
        peers: Array.isArray(result.peers) ? (result.peers as string[]) : [],
      });
    } catch (error) {
      // A 404 is not a bad moment - it is the wrong address. Retrying forever
      // against a server that does not exist looked like "nothing happened"
      // to the person waiting for their call to connect.
      if (error instanceof Error && error.message.includes('HTTP 404')) {
        this.#fatal(
          'No signalling server answers at this address. Calls work on the deployed app, or on the full local server (npm start) - the dev-only server has no call backend.',
        );
        return;
      }
      this.#setStatus('reconnecting');
      this.events.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** A failure that retrying cannot fix: stop, say so, and stay stopped. */
  #fatal(message: string): void {
    this.#closed = true;
    this.#abort?.abort();
    this.#abort = null;
    this.#setStatus('error');
    this.events.emit('error', new Error(message));
  }

  async #pollLoop(): Promise<void> {
    while (!this.#closed && this.#room && this.#peerId) {
      this.#abort = new AbortController();

      try {
        const query = `room=${encodeURIComponent(this.#room)}&peerId=${encodeURIComponent(this.#peerId)}`;
        const response = await fetch(`${this.#base}/api/signal/poll?${query}`, {
          signal: this.#abort.signal,
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });

        // 409 means the server has forgotten this peer - it was reaped after a
        // sleep, or the container restarted. Re-join rather than poll forever
        // against a room we are no longer in.
        if (response.status === 409) {
          await this.#join();
          continue;
        }
        if (response.status === 404) {
          this.#fatal(
            'No signalling server answers at this address. Calls work on the deployed app, or on the full local server (npm start) - the dev-only server has no call backend.',
          );
          return;
        }
        if (!response.ok) throw new Error(`Signalling poll failed: HTTP ${response.status}`);

        const body = (await response.json()) as { messages?: unknown };
        if (this.#status !== 'connected') this.#setStatus('connected');
        this.#attempt = 0;

        for (const message of Array.isArray(body.messages) ? body.messages : []) {
          if (isServerToClient(message)) this.#dispatch(message);
        }
      } catch (error) {
        if (this.#closed || (error instanceof DOMException && error.name === 'AbortError')) return;

        this.#setStatus('reconnecting');
        this.#attempt += 1;
        await new Promise((resolve) => {
          setTimeout(resolve, Math.min(15_000, 500 * 2 ** (this.#attempt - 1)));
        });
      }
    }
  }

  async #post(action: string, body: unknown): Promise<Record<string, unknown> | null> {
    const response = await fetch(`${this.#base}/api/signal/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok && response.status !== 400) {
      throw new Error(`Signalling ${action} failed: HTTP ${response.status}`);
    }
    return (await response.json()) as Record<string, unknown>;
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

  #setStatus(status: SignalingStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.events.emit('status', status);
  }
}
