import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpSignalingHub } from '../signaling/http-hub.js';
import { Rooms } from '../signaling/rooms.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * The application origin cannot signal over WebSockets: Firebase App Hosting's
 * edge answers a valid handshake with 403 before the request reaches the
 * container, on every path. These cover the HTTP transport that replaced it.
 */

describe('Rooms', () => {
  const sink = () => {
    const received: unknown[] = [];
    return { received, send: (m: unknown) => received.push(m) };
  };

  it('reports the peers already present on join', () => {
    const rooms = new Rooms({ logger: silent });
    expect(rooms.join('ROOM-1', 'alice', sink())).toMatchObject({ ok: true, peers: ['alice'] });
    expect(rooms.join('ROOM-1', 'bob', sink())).toMatchObject({ ok: true, peers: ['alice', 'bob'] });
  });

  it('tells existing peers when someone joins', () => {
    const rooms = new Rooms({ logger: silent });
    const alice = sink();
    rooms.join('ROOM-1', 'alice', alice);
    rooms.join('ROOM-1', 'bob', sink());
    expect(alice.received).toContainEqual({ t: 'peer-joined', peerId: 'bob' });
  });

  it('relays only to the addressed peer', () => {
    const rooms = new Rooms({ logger: silent });
    const alice = sink();
    const bob = sink();
    const carol = sink();
    rooms.join('ROOM-1', 'alice', alice);
    rooms.join('ROOM-1', 'bob', bob);
    rooms.join('ROOM-1', 'carol', carol);

    expect(rooms.relay('ROOM-1', 'alice', 'bob', { kind: 'candidate' })).toBe(true);
    expect(bob.received).toContainEqual({ t: 'signal', from: 'alice', payload: { kind: 'candidate' } });
    expect(carol.received.filter((m) => (m as { t: string }).t === 'signal')).toHaveLength(0);
  });

  it('reports an undeliverable relay so the caller can fan out to replicas', () => {
    const rooms = new Rooms({ logger: silent });
    rooms.join('ROOM-1', 'alice', sink());
    expect(rooms.relay('ROOM-1', 'alice', 'elsewhere', {})).toBe(false);
  });

  it('normalises room codes to upper case', () => {
    const rooms = new Rooms({ logger: silent });
    rooms.join('room-1', 'alice', sink());
    expect(rooms.has('ROOM-1', 'alice')).toBe(true);
  });

  it('rejects malformed rooms and peer ids', () => {
    const rooms = new Rooms({ logger: silent });
    expect(rooms.join('no', 'alice', sink())).toMatchObject({ ok: false });
    expect(rooms.join('ROOM-1', '', sink())).toMatchObject({ ok: false });
    expect(rooms.roomCount).toBe(0);
  });

  it('refuses a full room', () => {
    const rooms = new Rooms({ logger: silent, maxPeers: 2 });
    rooms.join('ROOM-1', 'a', sink());
    rooms.join('ROOM-1', 'b', sink());
    expect(rooms.join('ROOM-1', 'c', sink())).toMatchObject({ ok: false, error: 'This room is full.' });
  });

  it('forgets a room once empty, so nothing is retained', () => {
    const rooms = new Rooms({ logger: silent });
    rooms.join('ROOM-1', 'alice', sink());
    rooms.leave('ROOM-1', 'alice');
    expect(rooms.roomCount).toBe(0);
    expect(rooms.peerCount).toBe(0);
  });

  it('keeps delivering when one peer throws on send', () => {
    const rooms = new Rooms({ logger: silent });
    const healthy = sink();
    rooms.join('ROOM-1', 'broken', {
      send: () => {
        throw new Error('socket gone');
      },
    });
    rooms.join('ROOM-1', 'healthy', healthy);
    // A third join must still notify the healthy peer despite the broken one.
    rooms.join('ROOM-1', 'third', sink());
    expect(healthy.received).toContainEqual({ t: 'peer-joined', peerId: 'third' });
  });
});

describe('HttpSignalingHub', () => {
  let hub: HttpSignalingHub;

  beforeEach(() => {
    hub = new HttpSignalingHub({ logger: silent });
  });

  it('returns queued messages immediately when some are waiting', async () => {
    hub.join('ROOM-1', 'alice');
    hub.join('ROOM-1', 'bob');

    const result = await hub.poll('ROOM-1', 'alice', { timeoutMs: 50 });
    expect(result.ok).toBe(true);
    expect(result.messages).toContainEqual({ t: 'peer-joined', peerId: 'bob' });
  });

  it('holds the poll open until a message arrives', async () => {
    hub.join('ROOM-1', 'alice');
    hub.join('ROOM-1', 'bob');
    await hub.poll('ROOM-1', 'bob', { timeoutMs: 50 });

    const pending = hub.poll('ROOM-1', 'bob', { timeoutMs: 5000 });
    hub.send('ROOM-1', 'alice', 'bob', { kind: 'description' });

    const result = await pending;
    expect(result.messages).toContainEqual({
      t: 'signal',
      from: 'alice',
      payload: { kind: 'description' },
    });
  });

  it('returns empty at the timeout rather than hanging forever', async () => {
    hub.join('ROOM-1', 'alice');
    await hub.poll('ROOM-1', 'alice', { timeoutMs: 20 });

    const result = await hub.poll('ROOM-1', 'alice', { timeoutMs: 20 });
    expect(result).toEqual({ ok: true, messages: [] });
  });

  it('tells an unknown peer to re-join instead of polling into the void', async () => {
    const result = await hub.poll('ROOM-1', 'ghost', { timeoutMs: 20 });
    expect(result.ok).toBe(false);
  });

  it('refuses to signal from a peer that has not joined', () => {
    expect(hub.send('ROOM-1', 'stranger', 'bob', {})).toMatchObject({ ok: false });
  });

  it('reports whether a signal was delivered locally', () => {
    hub.join('ROOM-1', 'alice');
    hub.join('ROOM-1', 'bob');
    expect(hub.send('ROOM-1', 'alice', 'bob', {})).toEqual({ ok: true, delivered: true });
    expect(hub.send('ROOM-1', 'alice', 'nobody', {})).toEqual({ ok: true, delivered: false });
  });

  it('notifies the room when a peer leaves', async () => {
    hub.join('ROOM-1', 'alice');
    hub.join('ROOM-1', 'bob');
    await hub.poll('ROOM-1', 'alice', { timeoutMs: 20 });

    hub.leave('ROOM-1', 'bob');
    const result = await hub.poll('ROOM-1', 'alice', { timeoutMs: 20 });
    expect(result.messages).toContainEqual({ t: 'peer-left', peerId: 'bob' });
  });

  it('lets a peer re-join after leaving', () => {
    hub.join('ROOM-1', 'alice');
    hub.leave('ROOM-1', 'alice');
    expect(hub.join('ROOM-1', 'alice')).toMatchObject({ ok: true });
  });

  it('wakes a pending poll when the peer leaves, rather than stranding it', async () => {
    hub.join('ROOM-1', 'alice');
    await hub.poll('ROOM-1', 'alice', { timeoutMs: 20 });

    const pending = hub.poll('ROOM-1', 'alice', { timeoutMs: 5000 });
    hub.leave('ROOM-1', 'alice');
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it('caps a stalled peer’s queue instead of growing without bound', async () => {
    hub.join('ROOM-1', 'alice');
    hub.join('ROOM-1', 'bob');
    // Bob never polls; alice floods him.
    for (let i = 0; i < 400; i += 1) hub.send('ROOM-1', 'alice', 'bob', { i });

    const result = await hub.poll('ROOM-1', 'bob', { timeoutMs: 20 });
    expect(result.messages!.length).toBeLessThanOrEqual(200);
    // The newest are kept: an old ICE candidate is worth less than a recent one.
    expect(result.messages!.at(-1)).toMatchObject({ payload: { i: 399 } });
  });

  it('counts rooms and peers for the health endpoint', () => {
    hub.join('ROOM-1', 'alice');
    hub.join('ROOM-2', 'bob');
    expect(hub.roomCount).toBe(2);
    expect(hub.peerCount).toBe(2);
  });

  it('drops peers that stop polling, so rooms do not fill with ghosts', async () => {
    vi.useFakeTimers();
    const reaped = new HttpSignalingHub({ logger: silent });
    try {
      reaped.join('ROOM-1', 'alice');
      expect(reaped.peerCount).toBe(1);

      // An HTTP peer that closes its tab says nothing; silence is the signal.
      await vi.advanceTimersByTimeAsync(90_000);
      expect(reaped.peerCount).toBe(0);
    } finally {
      reaped.close();
      vi.useRealTimers();
    }
  });
});
