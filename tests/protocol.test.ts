import { describe, expect, it } from 'vitest';
import { isDataChannelMessage, isServerToClient, RTT_CHANNEL_LABEL } from '@/webrtc/protocol';
import { hasTurnServer } from '@/webrtc/ice';
import { createRoomCode, createId } from '@/lib/id';

describe('data channel guards', () => {
  it('accepts every message the peer may legitimately send', () => {
    expect(isDataChannelMessage({ t: 'rtt', id: 'a', text: 'hi', final: true, seq: 1, sentAt: 0 })).toBe(true);
    expect(isDataChannelMessage({ t: 'hello', displayName: 'Sam' })).toBe(true);
    expect(isDataChannelMessage({ t: 'state', emergencyOverride: true, composing: false })).toBe(true);
  });

  it('rejects anything else arriving on the channel', () => {
    for (const value of [null, undefined, 'rtt', 42, {}, { t: 'execute' }, []]) {
      expect(isDataChannelMessage(value)).toBe(false);
    }
  });

  it('names the RTT channel consistently', () => {
    expect(RTT_CHANNEL_LABEL).toBe('aac-rtt');
  });
});

describe('signalling guards', () => {
  it('accepts server messages', () => {
    expect(isServerToClient({ t: 'joined', room: 'A', peerId: 'b', peers: [] })).toBe(true);
    expect(isServerToClient({ t: 'signal', from: 'b', payload: {} })).toBe(true);
    expect(isServerToClient({ t: 'error', message: 'nope' })).toBe(true);
  });

  it('rejects unknown message types', () => {
    expect(isServerToClient({ t: 'shutdown' })).toBe(false);
    expect(isServerToClient('joined')).toBe(false);
  });
});

describe('ICE configuration', () => {
  it('detects a configured TURN relay', () => {
    expect(hasTurnServer([{ urls: 'turn:relay.example.org:3478' }])).toBe(true);
    expect(hasTurnServer([{ urls: ['stun:a', 'turns:relay.example.org:5349'] }])).toBe(true);
  });

  it('reports STUN-only configuration honestly', () => {
    expect(hasTurnServer([{ urls: ['stun:stun.l.google.com:19302'] }])).toBe(false);
    expect(hasTurnServer([])).toBe(false);
  });
});

describe('identifiers', () => {
  it('generates room codes from an unambiguous alphabet', () => {
    // No 0/O or 1/I: these get read aloud over a phone by people in a hurry.
    for (let index = 0; index < 50; index += 1) {
      expect(createRoomCode()).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    }
  });

  it('generates distinct prefixed ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createId('turn')));
    expect(ids.size).toBe(500);
    expect([...ids][0]).toMatch(/^turn_/);
  });
});

describe('platform detection', () => {
  it('reports capabilities without throwing in any environment', async () => {
    const { detectPlatform, usableThreadCount } = await import('@/lib/platform');
    const capabilities = detectPlatform();

    expect(typeof capabilities.crossOriginIsolated).toBe('boolean');
    expect(typeof capabilities.webAssemblyThreads).toBe('boolean');
    expect(capabilities.hardwareConcurrency).toBeGreaterThanOrEqual(1);

    // Without isolation the ONNX runtime is single-threaded, whatever the
    // core count says.
    expect(usableThreadCount({ ...capabilities, crossOriginIsolated: false, sharedArrayBuffer: false })).toBe(1);
    expect(
      usableThreadCount({
        ...capabilities,
        crossOriginIsolated: true,
        sharedArrayBuffer: true,
        hardwareConcurrency: 8,
      }),
    ).toBe(4);
  });
});

describe('reserved server paths', () => {
  // Regression: /api/* fell through to the single-page shell, so a mistyped
  // endpoint returned index.html with a 200 and the caller's JSON parser blew
  // up somewhere unrelated.
  const RESERVED = ['/api', '/signal', '/healthz'];

  const isReserved = (pathname: string): boolean =>
    RESERVED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  it('claims API, signalling and health paths', () => {
    for (const path of ['/api', '/api/ice-servers', '/api/nonsense', '/signal', '/healthz']) {
      expect(isReserved(path)).toBe(true);
    }
  });

  it('leaves application routes to the single-page shell', () => {
    for (const path of ['/', '/settings', '/call/ABCD-1234', '/apidocs', '/signalling']) {
      expect(isReserved(path)).toBe(false);
    }
  });
});

describe('engine loading progress', () => {
  // Emscripten counts several packaged files against one declared total, so the
  // raw ratio overshoots — it displayed "loading 111%" in production.
  const percentOf = (detail: string): number | null => {
    const match = /\((\d+)\/(\d+)\)/.exec(detail);
    if (!match) return null;
    const ratio = Number(match[1]) / Number(match[2]);
    return Math.min(100, Math.max(0, Math.round(ratio * 100)));
  };

  it('reports a normal download as a percentage', () => {
    expect(percentOf('Downloading data... (48262596/96525193)')).toBe(50);
  });

  it('clamps an overshooting total to 100', () => {
    expect(percentOf('Downloading data... (107000000/96525193)')).toBe(100);
  });

  it('never reports a negative percentage', () => {
    expect(percentOf('Downloading data... (0/96525193)')).toBe(0);
  });

  it('ignores status text with no counter', () => {
    expect(percentOf('Running...')).toBeNull();
  });
});
