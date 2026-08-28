import { describe, expect, it, vi } from 'vitest';
import { SignalingHub } from '../signaling/hub.js';

type Handler = (...args: unknown[]) => void;

/** Minimal stand-in for a `ws` socket: enough surface for the hub to drive. */
class FakeSocket {
  readyState = 1;
  readonly sent: Record<string, unknown>[] = [];
  #handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler): this {
    const list = this.#handlers.get(event) ?? [];
    list.push(handler);
    this.#handlers.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.#handlers.get(event) ?? []) handler(...args);
  }

  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as Record<string, unknown>);
  }

  receive(message: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }

  lastMessage(): Record<string, unknown> | undefined {
    return this.sent.at(-1);
  }

  messagesOfType(type: string): Record<string, unknown>[] {
    return this.sent.filter((message) => message.t === type);
  }
}

function connect(hub: SignalingHub): FakeSocket {
  const socket = new FakeSocket();
  hub.handleConnection(socket as never);
  return socket;
}

const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe('SignalingHub', () => {
  it('confirms a join and lists the peers already present', () => {
    const hub = new SignalingHub({ logger: silent });
    const alice = connect(hub);
    alice.receive({ t: 'join', room: 'ROOM-1', peerId: 'alice' });

    expect(alice.lastMessage()).toMatchObject({ t: 'joined', room: 'ROOM-1', peers: ['alice'] });
  });

  it('tells existing peers when someone else joins', () => {
    const hub = new SignalingHub({ logger: silent });
    const alice = connect(hub);
    const bob = connect(hub);

    alice.receive({ t: 'join', room: 'ROOM-1', peerId: 'alice' });
    bob.receive({ t: 'join', room: 'ROOM-1', peerId: 'bob' });

    expect(alice.messagesOfType('peer-joined')).toHaveLength(1);
    expect(bob.lastMessage()).toMatchObject({ t: 'joined', peers: ['alice', 'bob'] });
  });

  it('relays a signal only to the addressed peer', () => {
    const hub = new SignalingHub({ logger: silent });
    const alice = connect(hub);
    const bob = connect(hub);
    const carol = connect(hub);

    alice.receive({ t: 'join', room: 'ROOM-1', peerId: 'alice' });
    bob.receive({ t: 'join', room: 'ROOM-1', peerId: 'bob' });
    carol.receive({ t: 'join', room: 'ROOM-1', peerId: 'carol' });

    alice.receive({ t: 'signal', to: 'bob', payload: { kind: 'description', description: { type: 'offer' } } });

    expect(bob.messagesOfType('signal')).toHaveLength(1);
    expect(bob.messagesOfType('signal')[0]).toMatchObject({ from: 'alice' });
    expect(carol.messagesOfType('signal')).toHaveLength(0);
  });

  it('notifies the room when a peer disconnects', () => {
    const hub = new SignalingHub({ logger: silent });
    const alice = connect(hub);
    const bob = connect(hub);

    alice.receive({ t: 'join', room: 'ROOM-1', peerId: 'alice' });
    bob.receive({ t: 'join', room: 'ROOM-1', peerId: 'bob' });
    bob.emit('close');

    expect(alice.messagesOfType('peer-left')).toHaveLength(1);
    expect(alice.messagesOfType('peer-left')[0]).toMatchObject({ peerId: 'bob' });
  });

  it('forgets a room once it is empty, so nothing is retained', () => {
    const hub = new SignalingHub({ logger: silent });
    const alice = connect(hub);

    alice.receive({ t: 'join', room: 'ROOM-1', peerId: 'alice' });
    expect(hub.roomCount).toBe(1);

    alice.emit('close');
    expect(hub.roomCount).toBe(0);
    expect(hub.peerCount).toBe(0);
  });

  it('rejects malformed room codes', () => {
    const hub = new SignalingHub({ logger: silent });
    const socket = connect(hub);
    socket.receive({ t: 'join', room: 'no', peerId: 'alice' });

    expect(socket.lastMessage()).toMatchObject({ t: 'error' });
    expect(hub.roomCount).toBe(0);
  });

  it('refuses a room that is already full', () => {
    const hub = new SignalingHub({ logger: silent });
    for (let index = 0; index < 4; index += 1) {
      connect(hub).receive({ t: 'join', room: 'ROOM-1', peerId: `peer-${index}` });
    }

    const latecomer = connect(hub);
    latecomer.receive({ t: 'join', room: 'ROOM-1', peerId: 'peer-4' });
    expect(latecomer.lastMessage()).toMatchObject({ t: 'error', message: 'This room is full.' });
  });

  it('answers malformed JSON with an error rather than crashing', () => {
    const hub = new SignalingHub({ logger: silent });
    const socket = connect(hub);
    socket.emit('message', Buffer.from('{ not json'));

    expect(socket.lastMessage()).toMatchObject({ t: 'error', message: 'Malformed JSON.' });
  });

  it('moves a peer cleanly when it rejoins a different room', () => {
    const hub = new SignalingHub({ logger: silent });
    const alice = connect(hub);

    alice.receive({ t: 'join', room: 'ROOM-1', peerId: 'alice' });
    alice.receive({ t: 'join', room: 'ROOM-2', peerId: 'alice' });

    expect(hub.roomCount).toBe(1);
    expect(hub.peerCount).toBe(1);
  });

  it('answers a heartbeat', () => {
    const hub = new SignalingHub({ logger: silent });
    const socket = connect(hub);
    socket.receive({ t: 'ping' });
    expect(socket.lastMessage()).toMatchObject({ t: 'pong' });
  });

  it('publishes to other replicas when the target is not local', () => {
    const hub = new SignalingHub({ logger: silent });
    const publish = vi.fn();
    hub.setBroadcaster({ publish });

    const alice = connect(hub);
    alice.receive({ t: 'join', room: 'ROOM-1', peerId: 'alice' });
    alice.receive({ t: 'signal', to: 'elsewhere', payload: { kind: 'candidate', candidate: null } });

    const relayed = publish.mock.calls.map(([, payload]) => JSON.parse(payload as string));
    expect(relayed.some((message) => message.t === 'signal' && message.to === 'elsewhere')).toBe(true);
  });

  it('delivers a broadcast from another replica to the addressed peer', () => {
    const hub = new SignalingHub({ logger: silent });
    const bob = connect(hub);
    bob.receive({ t: 'join', room: 'ROOM-1', peerId: 'bob' });

    hub.deliverFromBroadcast(
      'ROOM-1',
      JSON.stringify({ t: 'signal', from: 'alice', to: 'bob', payload: { kind: 'candidate', candidate: null } }),
    );

    const signals = bob.messagesOfType('signal');
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ from: 'alice' });
    // The routing envelope must not leak through to the client.
    expect(signals[0]).not.toHaveProperty('to');
  });

  it('rejects an oversized frame', () => {
    const hub = new SignalingHub({ logger: silent });
    const socket = connect(hub);
    socket.emit('message', Buffer.alloc(70 * 1024));
    expect(socket.lastMessage()).toMatchObject({ t: 'error', message: 'Message too large.' });
  });
});
