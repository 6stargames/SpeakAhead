/**
 * HTTP long-polling signalling.
 *
 * Firebase App Hosting's edge refuses WebSocket upgrades: it answers a valid
 * handshake with 403 before the request reaches the container, for every path,
 * including ones the origin would have rejected itself. Plain HTTP passes
 * through untouched. So the application origin signals over HTTP.
 *
 * Long-polling rather than Server-Sent Events on purpose: every response
 * completes normally, so no proxy in the path can buffer a stream and stall
 * call setup. The cost is one extra round trip per message, which is
 * immaterial. Signalling happens during setup; once the peer connection is up,
 * media and real-time text flow directly between the browsers.
 *
 * Shares `Rooms` with the WebSocket transport so both speak identical
 * semantics, rather than drifting into two subtly different protocols.
 */

import { Rooms } from './rooms.js';

/**
 * How long a poll waits before returning empty. Short enough to survive any
 * proxy idle timeout, long enough that polling is not a busy loop.
 */
const POLL_TIMEOUT_MS = 25_000;

/** A peer that stops polling for this long is treated as gone. */
const PEER_TTL_MS = 70_000;

const MAX_BODY_BYTES = 64 * 1024;
const MAX_QUEUE = 200;

export class HttpSignalingHub {
  #rooms;
  /** @type {Map<string, {queue: unknown[], wake: null | (() => void), lastSeen: number, room: string}>} */
  #peers = new Map();
  #reaper;

  constructor({ logger = console } = {}) {
    this.#rooms = new Rooms({ logger });
    this.#reaper = setInterval(() => this.#reap(), 15_000);
    this.#reaper.unref?.();
  }

  get roomCount() {
    return this.#rooms.roomCount;
  }

  get peerCount() {
    return this.#rooms.peerCount;
  }

  close() {
    clearInterval(this.#reaper);
  }

  #key(room, peerId) {
    return `${String(room).toUpperCase()} ${peerId}`;
  }

  #peerState(room, peerId) {
    return this.#peers.get(this.#key(room, peerId));
  }

  /**
   * Drop peers that have stopped polling.
   *
   * A closing browser tab does not announce itself over HTTP the way a closing
   * socket does, so silence is the only signal that someone has gone. Without
   * this, rooms fill with ghosts and the next caller is told the room is full.
   */
  #reap() {
    const now = Date.now();
    for (const [key, state] of [...this.#peers]) {
      if (now - state.lastSeen <= PEER_TTL_MS) continue;
      const peerId = key.slice(key.indexOf(' ') + 1);
      this.#peers.delete(key);
      this.#rooms.leave(state.room, peerId);
      state.wake?.();
    }
  }

  // -------------------------------------------------------------------------

  join(room, peerId) {
    const key = this.#key(room, peerId);
    const existing = this.#peers.get(key);
    const state = existing ?? {
      queue: [],
      wake: null,
      lastSeen: Date.now(),
      room: String(room).toUpperCase(),
    };

    const result = this.#rooms.join(room, peerId, {
      send: (message) => {
        // Drop the oldest rather than grow without bound: a peer this far
        // behind has stopped polling and is about to be reaped anyway.
        if (state.queue.length >= MAX_QUEUE) state.queue.shift();
        state.queue.push(message);
        state.wake?.();
      },
    });

    if (!result.ok) return result;

    state.lastSeen = Date.now();
    state.room = result.room;
    this.#peers.set(this.#key(result.room, peerId), state);
    return result;
  }

  send(room, from, to, payload) {
    const state = this.#peerState(room, from);
    if (!state) return { ok: false, error: 'Join the room before signalling.' };
    state.lastSeen = Date.now();

    const delivered = this.#rooms.relay(room, from, to, payload);
    return { ok: true, delivered };
  }

  leave(room, peerId) {
    const key = this.#key(room, peerId);
    const state = this.#peers.get(key);
    this.#peers.delete(key);
    this.#rooms.leave(room, peerId);
    state?.wake?.();
    return { ok: true };
  }

  /**
   * Wait for messages addressed to a peer.
   *
   * Resolves as soon as anything is queued, or empty at the timeout so the
   * client can poll again. Returning empty rather than holding indefinitely is
   * what keeps each request short-lived enough for proxies to leave alone.
   */
  poll(room, peerId, { timeoutMs = POLL_TIMEOUT_MS } = {}) {
    const state = this.#peerState(room, peerId);
    if (!state) return Promise.resolve({ ok: false, error: 'Unknown peer. Re-join the room.' });

    state.lastSeen = Date.now();
    if (state.queue.length > 0) {
      return Promise.resolve({ ok: true, messages: state.queue.splice(0, state.queue.length) });
    }

    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        state.wake = null;
        state.lastSeen = Date.now();
        resolve({ ok: true, messages: state.queue.splice(0, state.queue.length) });
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref?.();
      state.wake = finish;
    });
  }
}

/** Read and parse a JSON request body with a hard size cap. */
export async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Malformed JSON.'));
      }
    });

    req.on('error', reject);
  });
}
