import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthHeaders,
  createIceServerResolver,
  mintSharedSecretCredentials,
  normaliseIceServers,
} from '../ice-servers.js';

const FIXED_NOW = 1_700_000_000_000;

describe('mintSharedSecretCredentials', () => {
  it('produces an RFC 5766 username of <expiry>:<user>', () => {
    const { iceServers } = mintSharedSecretCredentials({
      urls: ['turn:relay.example.org:3478'],
      secret: 'shh',
      userId: 'alice',
      ttlSeconds: 3600,
      now: FIXED_NOW,
    });

    const turn = iceServers.find((server) => String(server.urls).includes('turn:'));
    expect(turn?.username).toBe(`${FIXED_NOW / 1000 + 3600}:alice`);
    expect(typeof turn?.credential).toBe('string');
  });

  it('is deterministic for the same inputs and differs across secrets', () => {
    const base = { urls: ['turn:a:3478'], userId: 'a', ttlSeconds: 60, now: FIXED_NOW };
    const first = mintSharedSecretCredentials({ ...base, secret: 'one' });
    const again = mintSharedSecretCredentials({ ...base, secret: 'one' });
    const other = mintSharedSecretCredentials({ ...base, secret: 'two' });

    expect(first.iceServers[1]?.credential).toBe(again.iceServers[1]?.credential);
    expect(first.iceServers[1]?.credential).not.toBe(other.iceServers[1]?.credential);
    expect(first.iceServers[1]?.credential).toBeTypeOf('string');
  });

  it('always keeps a STUN server alongside the relay', () => {
    const { iceServers } = mintSharedSecretCredentials({
      urls: ['turn:a:3478'],
      secret: 's',
      now: FIXED_NOW,
    });
    expect(String(iceServers[0]?.urls)).toContain('stun:');
  });

  it('refuses to mint without a secret or a relay URL', () => {
    expect(() => mintSharedSecretCredentials({ urls: [], secret: 's', now: FIXED_NOW })).toThrow(/TURN_URLS/);
    expect(() => mintSharedSecretCredentials({ urls: ['turn:a'], secret: '', now: FIXED_NOW })).toThrow(
      /TURN_SHARED_SECRET/,
    );
  });
});

describe('normaliseIceServers', () => {
  it('accepts the three shapes providers actually return', () => {
    expect(normaliseIceServers([{ urls: 'turn:a', username: 'u', credential: 'c' }])).toHaveLength(1);
    expect(normaliseIceServers({ iceServers: [{ urls: ['turn:a'] }] })).toHaveLength(1);
    expect(normaliseIceServers({ ice_servers: [{ url: 'turn:a', username: 'u', password: 'p' }] })).toHaveLength(1);
  });

  it('maps snake_case credential fields onto the WebRTC names', () => {
    const [server] = normaliseIceServers({ ice_servers: [{ url: 'turn:a', username: 'u', password: 'p' }] });
    expect(server).toEqual({ urls: ['turn:a'], username: 'u', credential: 'p' });
  });

  it('rejects a response with nothing usable in it', () => {
    expect(() => normaliseIceServers({})).toThrow(/no usable ICE servers/);
    expect(() => normaliseIceServers({ iceServers: [{ nope: true }] })).toThrow(/no usable ICE servers/);
  });
});

describe('normaliseIceServers — Cloudflare Realtime', () => {
  // The exact shape returned by
  // POST /v1/turn/keys/<id>/credentials/generate-ice-servers
  const CLOUDFLARE_RESPONSE = {
    iceServers: [
      {
        urls: [
          'stun:stun.cloudflare.com:3478',
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:3478?transport=tcp',
          'turns:turn.cloudflare.com:5349?transport=tcp',
        ],
        username: 'generated-username',
        credential: 'generated-credential',
      },
    ],
  };

  it('normalises the response without mangling transport query strings', () => {
    const [server] = normaliseIceServers(CLOUDFLARE_RESPONSE);
    expect(server?.urls).toHaveLength(4);
    expect(server?.urls).toContain('turn:turn.cloudflare.com:3478?transport=udp');
    expect(server?.username).toBe('generated-username');
    expect(server?.credential).toBe('generated-credential');
  });

  it('keeps a relay entry, which is the whole point of configuring TURN', () => {
    const [server] = normaliseIceServers(CLOUDFLARE_RESPONSE);
    expect(server?.urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:'))).toBe(true);
  });

  it('survives a single object instead of an array', () => {
    // Some Cloudflare endpoints return iceServers as one object rather than a list.
    const servers = normaliseIceServers({ iceServers: CLOUDFLARE_RESPONSE.iceServers[0] });
    expect(servers).toHaveLength(1);
    expect(servers[0]?.username).toBe('generated-username');
  });
});

describe('buildAuthHeaders', () => {
  it('uses a full header line as given', () => {
    expect(buildAuthHeaders('Authorization: Bearer abc123')).toEqual({ Authorization: 'Bearer abc123' });
  });

  it('supports providers that use their own header name', () => {
    expect(buildAuthHeaders('X-Api-Key: abc123')).toEqual({ 'X-Api-Key': 'abc123' });
  });

  it('treats a bare token as a bearer', () => {
    // The likeliest way to configure this wrong: copy the token out of a
    // dashboard, paste it in, forget the prefix. Rejecting it would fall back
    // to STUN silently, which is worse than being forgiving here.
    expect(buildAuthHeaders('36b3b759414723164dd1b5fe6a514f86')).toEqual({
      Authorization: 'Bearer 36b3b759414723164dd1b5fe6a514f86',
    });
  });

  it('does not double the Bearer prefix', () => {
    expect(buildAuthHeaders('Bearer abc123')).toEqual({ Authorization: 'Bearer abc123' });
  });

  it('does not split a value whose colon is not a header separator', () => {
    expect(buildAuthHeaders('https://example.com/token')).toEqual({
      Authorization: 'Bearer https://example.com/token',
    });
  });

  it('trims stray whitespace from a pasted value', () => {
    expect(buildAuthHeaders('  Authorization:   Bearer abc  ')).toEqual({ Authorization: 'Bearer abc' });
  });

  it('sends nothing when no auth is configured', () => {
    expect(buildAuthHeaders(undefined)).toEqual({});
    expect(buildAuthHeaders('   ')).toEqual({});
  });
});

describe('createIceServerResolver', () => {
  it('returns STUN only when no provider is configured', async () => {
    const resolver = createIceServerResolver({});
    const result = await resolver.resolve();

    expect(result.provider).toBe('none');
    expect(result.iceServers).toHaveLength(1);
    expect(String(result.iceServers[0]?.urls)).toContain('stun:');
  });

  it('mints shared-secret credentials without any network call', async () => {
    const resolver = createIceServerResolver({
      TURN_PROVIDER: 'shared-secret',
      TURN_URLS: 'turn:relay.example.org:3478,turns:relay.example.org:5349',
      TURN_SHARED_SECRET: 'secret',
    });
    const result = await resolver.resolve();

    expect(result.iceServers).toHaveLength(2);
    expect(result.iceServers[1]?.urls).toEqual(['turn:relay.example.org:3478', 'turns:relay.example.org:5349']);
  });

  it('caches until the credentials approach expiry', async () => {
    const fetchProvider = vi.fn(async () => ({
      iceServers: [{ urls: ['turn:a'], username: 'u', credential: 'c' }],
      expiresAt: FIXED_NOW + 3_600_000,
    }));
    let clock = FIXED_NOW;
    const resolver = createIceServerResolver(
      { TURN_PROVIDER: 'fetch', TURN_CREDENTIALS_URL: 'https://provider.example/creds' },
      { now: () => clock, fetchProvider },
    );

    await resolver.resolve();
    await resolver.resolve();
    expect(fetchProvider).toHaveBeenCalledTimes(1);

    // Past the refresh margin: fetch again rather than serve a stale credential.
    clock = FIXED_NOW + 3_600_000;
    await resolver.resolve();
    expect(fetchProvider).toHaveBeenCalledTimes(2);
  });

  it('degrades to STUN when the provider fails instead of blocking calls', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resolver = createIceServerResolver(
      { TURN_PROVIDER: 'fetch', TURN_CREDENTIALS_URL: 'https://provider.example/creds' },
      {
        fetchProvider: async () => {
          throw new Error('provider is down');
        },
      },
    );

    const result = await resolver.resolve();
    expect(result.degraded).toBe(true);
    expect(String(result.iceServers[0]?.urls)).toContain('stun:');
    expect(error).toHaveBeenCalled();
  });

  it('does not cache a degraded result for long', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchProvider = vi.fn(async () => {
      throw new Error('down');
    });
    const resolver = createIceServerResolver(
      { TURN_PROVIDER: 'fetch', TURN_CREDENTIALS_URL: 'https://x' },
      { fetchProvider },
    );

    await resolver.resolve();
    await resolver.resolve();
    // A transient provider outage should be retried, not remembered.
    expect(fetchProvider).toHaveBeenCalledTimes(2);
  });
});
