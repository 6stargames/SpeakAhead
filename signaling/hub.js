/**
 * WebSocket signalling.
 *
 * Used by the standalone regional deployment, where the host actually permits
 * WebSocket upgrades. The application origin cannot use this: Firebase App
 * Hosting's edge answers a valid handshake with 403 before the request reaches
 * the container, so that origin signals over HTTP instead — see http-hub.js.
 *
 * Room membership and routing live in `Rooms`, shared with the HTTP transport,
 * so the two speak identical semantics rather than drifting apart.
 *
 * Deliberately dumb: it relays SDP and ICE between a handful of peers and keeps
 * nothing. No transcripts, no audio, no room history, no persistence. The less
 * this server knows, the less there is to leak, which matters more than usual
 * when the payloads belong to medical conversations.
 */

import { Rooms } from './rooms.js';

const MAX_MESSAGE_BYTES = 64 * 1024;

export class SignalingHub {
  #rooms;
  /** @type {{ publish?: (channel: string, payload: string) => void } | null} */
  #broadcaster = null;
  #logger;

  constructor({ logger = console } = {}) {
    this.#logger = logger;
    this.#rooms = new Rooms({ logger });
  }

  /**
   * Attach a cross-replica broadcaster so several signalling instances can
   * serve one room. Optional: a single replica needs nothing.
   */
  setBroadcaster(broadcaster) {
    this.#broadcaster = broadcaster;
  }

  get roomCount() {
    return this.#rooms.roomCount;
  }

  get peerCount() {
    return this.#rooms.peerCount;
  }

  /** @param {import('ws').WebSocket} socket */
  handleConnection(socket) {
    const state = { room: null, peerId: null, alive: true };
    const sink = { send: (message) => this.#send(socket, message) };

    socket.on('pong', () => {
      state.alive = true;
    });

    socket.on('message', (raw) => {
      if (raw.length > MAX_MESSAGE_BYTES) {
        this.#send(socket, { t: 'error', message: 'Message too large.' });
        return;
      }

      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        this.#send(socket, { t: 'error', message: 'Malformed JSON.' });
        return;
      }

      switch (message?.t) {
        case 'join':
          this.#join(socket, sink, state, message);
          break;
        case 'signal':
          this.#relay(state, message);
          break;
        case 'leave':
          this.#leave(state);
          break;
        case 'ping':
          this.#send(socket, { t: 'pong' });
          break;
        default:
          this.#send(socket, { t: 'error', message: `Unknown message type: ${String(message?.t)}` });
      }
    });

    socket.on('close', () => this.#leave(state));
    socket.on('error', () => this.#leave(state));

    return state;
  }

  #join(socket, sink, state, message) {
    if (state.room) this.#leave(state);

    const result = this.#rooms.join(message.room, message.peerId, sink);
    if (!result.ok) {
      this.#send(socket, { t: 'error', message: result.error });
      return;
    }

    state.room = result.room;
    state.peerId = String(message.peerId);

    this.#send(socket, { t: 'joined', room: result.room, peerId: state.peerId, peers: result.peers });
    this.#broadcaster?.publish?.(result.room, JSON.stringify({ t: 'peer-joined', peerId: state.peerId }));
  }

  #relay(state, message) {
    if (!state.room || !state.peerId) return;

    const delivered = this.#rooms.relay(state.room, state.peerId, message.to, message.payload);
    if (delivered) return;

    // The peer may be attached to another replica.
    this.#broadcaster?.publish?.(
      state.room,
      JSON.stringify({ t: 'signal', from: state.peerId, to: message.to, payload: message.payload }),
    );
  }

  #leave(state) {
    if (!state.room || !state.peerId) return;
    const { room, peerId } = state;

    state.room = null;
    state.peerId = null;

    this.#rooms.leave(room, peerId);
    this.#broadcaster?.publish?.(room, JSON.stringify({ t: 'peer-left', peerId }));
  }

  /** Deliver a message that arrived from another replica. */
  deliverFromBroadcast(room, payload) {
    let message;
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }

    if (message.to) {
      const { to, ...rest } = message;
      this.#rooms.deliverTo(room, to, rest);
      return;
    }
    this.#rooms.broadcast(room, message);
  }

  #send(socket, message) {
    if (socket.readyState !== 1 /* OPEN */) return;
    socket.send(JSON.stringify(message));
  }

  /**
   * Drop connections that have stopped answering.
   *
   * Institutional middleboxes routinely half-close idle WebSockets without
   * telling either end, which otherwise leaves ghost peers in rooms forever.
   */
  startHeartbeat(wss, intervalMs = 30_000) {
    const states = new WeakMap();

    wss.on('connection', (socket) => {
      states.set(socket, { alive: true });
      socket.on('pong', () => {
        const entry = states.get(socket);
        if (entry) entry.alive = true;
      });
    });

    const timer = setInterval(() => {
      for (const socket of wss.clients) {
        const entry = states.get(socket);
        if (entry && entry.alive === false) {
          socket.terminate();
          continue;
        }
        if (entry) entry.alive = false;
        try {
          socket.ping();
        } catch {
          socket.terminate();
        }
      }
    }, intervalMs);

    timer.unref?.();
    wss.on('close', () => clearInterval(timer));
    return timer;
  }
}

/**
 * Optional Redis fan-out for horizontally scaled deployments.
 * Returns null when REDIS_URL is unset or ioredis is not installed.
 */
export async function createRedisBroadcaster(url, hub, logger = console) {
  if (!url) return null;
  try {
    // The specifier is held in a variable on purpose: ioredis is an optional
    // peer, and a literal here would make every static analyser that touches
    // this file (bundlers, the test runner) fail to resolve it when it is not
    // installed. This file always runs unbundled under Node.
    const specifier = 'ioredis';
    const { default: Redis } = await import(specifier);
    const publisher = new Redis(url);
    const subscriber = new Redis(url);

    await subscriber.psubscribe('aac:room:*');
    subscriber.on('pmessage', (_pattern, channel, payload) => {
      hub.deliverFromBroadcast(channel.replace('aac:room:', ''), payload);
    });

    logger.info?.('[signal] Redis fan-out active.');
    return {
      publish: (room, payload) => void publisher.publish(`aac:room:${room}`, payload),
      close: async () => {
        await Promise.allSettled([publisher.quit(), subscriber.quit()]);
      },
    };
  } catch (error) {
    logger.warn?.(
      `[signal] REDIS_URL is set but the fan-out could not start (${error?.message ?? error}). ` +
        'Running single-replica. Install "ioredis" to enable it.',
    );
    return null;
  }
}
