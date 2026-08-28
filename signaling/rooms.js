/**
 * Room membership and message routing, independent of transport.
 *
 * Two transports need identical semantics: WebSocket for a standalone regional
 * deployment, and HTTP long-polling for the application origin — Firebase App
 * Hosting's edge refuses WebSocket upgrades, returning 403 before the request
 * reaches the container. Implementing rooms twice would guarantee they drift,
 * and a signalling bug that only reproduces on one transport is a miserable
 * thing to chase. So the rules live here once and each transport supplies a
 * `sink`: anything with `send(message)`.
 *
 * Deliberately forgetful. It holds SDP and ICE in memory for the life of a
 * room, and nothing else — no transcripts, no audio, no history. The less this
 * knows, the less there is to leak from conversations that may be medical.
 */

const MAX_PEERS_PER_ROOM = 4;
const ROOM_PATTERN = /^[A-Z0-9-]{4,32}$/;
const MAX_PEER_ID = 64;

export class Rooms {
  /** @type {Map<string, Map<string, {send: (message: unknown) => void}>>} */
  #rooms = new Map();
  #logger;
  #maxPeers;

  constructor({ logger = console, maxPeers = MAX_PEERS_PER_ROOM } = {}) {
    this.#logger = logger;
    this.#maxPeers = maxPeers;
  }

  get roomCount() {
    return this.#rooms.size;
  }

  get peerCount() {
    let total = 0;
    for (const peers of this.#rooms.values()) total += peers.size;
    return total;
  }

  /** @returns {{ok: true, peers: string[]} | {ok: false, error: string}} */
  join(room, peerId, sink) {
    const normalised = String(room ?? '').toUpperCase();
    const id = String(peerId ?? '');

    if (!ROOM_PATTERN.test(normalised)) {
      return { ok: false, error: 'Room codes must be 4–32 characters: A–Z, 0–9 or hyphen.' };
    }
    if (id.length === 0 || id.length > MAX_PEER_ID) {
      return { ok: false, error: 'Invalid peer id.' };
    }

    let peers = this.#rooms.get(normalised);
    if (!peers) {
      peers = new Map();
      this.#rooms.set(normalised, peers);
    }

    if (peers.size >= this.#maxPeers && !peers.has(id)) {
      return { ok: false, error: 'This room is full.' };
    }

    peers.set(id, sink);

    for (const [otherId, otherSink] of peers) {
      if (otherId === id) continue;
      this.#deliver(otherSink, { t: 'peer-joined', peerId: id });
    }

    this.#logger.info?.(`[signal] ${id} joined ${normalised} (${peers.size} in room)`);
    return { ok: true, room: normalised, peers: [...peers.keys()] };
  }

  leave(room, peerId) {
    const normalised = String(room ?? '').toUpperCase();
    const peers = this.#rooms.get(normalised);
    if (!peers || !peers.has(peerId)) return;

    peers.delete(peerId);
    for (const sink of peers.values()) this.#deliver(sink, { t: 'peer-left', peerId });

    // Rooms are not retained once empty; there is nothing worth keeping.
    if (peers.size === 0) this.#rooms.delete(normalised);
    this.#logger.info?.(`[signal] ${peerId} left ${normalised}`);
  }

  /** @returns {boolean} whether the target was present locally. */
  relay(room, from, to, payload) {
    const peers = this.#rooms.get(String(room ?? '').toUpperCase());
    if (!peers) return false;

    const target = peers.get(String(to ?? ''));
    if (!target) return false;

    this.#deliver(target, { t: 'signal', from, payload });
    return true;
  }

  /** Deliver a message that arrived from another replica. */
  deliverTo(room, peerId, message) {
    const sink = this.#rooms.get(String(room ?? '').toUpperCase())?.get(peerId);
    if (sink) this.#deliver(sink, message);
  }

  broadcast(room, message) {
    const peers = this.#rooms.get(String(room ?? '').toUpperCase());
    if (!peers) return;
    for (const sink of peers.values()) this.#deliver(sink, message);
  }

  has(room, peerId) {
    return this.#rooms.get(String(room ?? '').toUpperCase())?.has(peerId) ?? false;
  }

  peersIn(room) {
    return [...(this.#rooms.get(String(room ?? '').toUpperCase())?.keys() ?? [])];
  }

  #deliver(sink, message) {
    try {
      sink.send(message);
    } catch (error) {
      // One unwritable peer must not stop the others being told.
      this.#logger.warn?.(`[signal] delivery failed: ${error?.message ?? error}`);
    }
  }
}
