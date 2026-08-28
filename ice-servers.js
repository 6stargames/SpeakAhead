/**
 * Runtime ICE server configuration.
 *
 * TURN credentials must never reach the client bundle. `VITE_ICE_SERVERS` is
 * inlined at build time, so anything put there is readable by anyone who opens
 * the page — and a leaked TURN credential means relaying strangers' traffic on
 * your bill. This module mints or fetches short-lived credentials server-side
 * and hands the browser only what it needs, when it needs it.
 *
 * Two strategies, selected by TURN_PROVIDER:
 *
 *   shared-secret  RFC 5766 TURN REST API. Works with coturn and any provider
 *                  that exposes a static auth secret. Computed locally, no
 *                  network call, no external dependency.
 *
 *   fetch          Ask the provider's own API. Deliberately generic — the
 *                  operator supplies the exact URL, method and auth header from
 *                  their provider's documentation rather than trusting this
 *                  file to have hard-coded an endpoint that has since moved.
 *                  The three common response shapes are normalised.
 */

import { createHmac } from 'node:crypto';

const DEFAULT_STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/** Credentials are refreshed this long before they actually expire. */
const REFRESH_MARGIN_SECONDS = 300;

function parseUrls(value) {
  return String(value ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

/**
 * RFC 5766 TURN REST API.
 *
 * username   = <unix expiry>:<user id>
 * credential = base64(HMAC-SHA1(secret, username))
 */
export function mintSharedSecretCredentials({ urls, secret, userId = 'aac', ttlSeconds = 86400, now = Date.now() }) {
  if (urls.length === 0) throw new Error('TURN_URLS is empty.');
  if (!secret) throw new Error('TURN_SHARED_SECRET is not set.');

  const expiry = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiry}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');

  return {
    iceServers: [...DEFAULT_STUN, { urls, username, credential }],
    expiresAt: expiry * 1000,
  };
}

/**
 * Normalise a provider response into RTCIceServer[].
 *
 * Providers disagree: some return `iceServers`, some `ice_servers`, some a bare
 * array, and some spell the fields in snake_case.
 */
export function normaliseIceServers(payload) {
  const candidate =
    (Array.isArray(payload) && payload) ||
    payload?.iceServers ||
    payload?.ice_servers ||
    payload?.v?.iceServers ||
    null;

  const list = Array.isArray(candidate) ? candidate : candidate ? [candidate] : [];

  const servers = list
    .map((entry) => {
      const urls = entry?.urls ?? entry?.url ?? entry?.uris;
      if (!urls) return null;
      const server = { urls: Array.isArray(urls) ? urls : [urls] };
      const username = entry.username ?? entry.user;
      const credential = entry.credential ?? entry.password ?? entry.pass;
      if (username) server.username = username;
      if (credential) server.credential = credential;
      return server;
    })
    .filter(Boolean);

  if (servers.length === 0) {
    throw new Error('The TURN provider returned no usable ICE servers.');
  }
  return servers;
}

/**
 * Turn the configured auth value into request headers.
 *
 * Accepts a full header line (`Authorization: Bearer abc`, `X-Api-Key: abc`) or
 * a bare token. The bare-token case is not laxness for its own sake: an
 * operator copying a token out of a provider's dashboard and pasting it into a
 * secret is the single most likely way to configure this, and rejecting it
 * would produce a silent fallback to STUN — a call that connects, looks
 * healthy, and carries no audio on exactly the networks TURN exists for.
 */
export function buildAuthHeaders(authHeader) {
  const value = String(authHeader ?? '').trim();
  if (value.length === 0) return {};

  const separator = value.indexOf(':');
  const name = separator === -1 ? '' : value.slice(0, separator).trim();

  // A scheme like `https` is a perfectly legal RFC 7230 field-name, so a URL
  // would otherwise split into a header called "https". Rule it out first.
  const looksLikeUrl = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);

  // RFC 7230 field-name characters. A token containing a colon has no valid
  // header name in front of it and must not be split here.
  if (!looksLikeUrl && separator !== -1 && /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
    return { [name]: value.slice(separator + 1).trim() };
  }

  return { Authorization: /^Bearer\s/i.test(value) ? value : `Bearer ${value}` };
}

async function fetchProviderCredentials({ url, method, authHeader, body, ttlSeconds }) {
  if (!url) throw new Error('TURN_CREDENTIALS_URL is not set.');

  const headers = { Accept: 'application/json', ...buildAuthHeaders(authHeader) };
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers,
    body: body ?? undefined,
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`TURN provider responded ${response.status} ${response.statusText}.`);
  }

  return {
    iceServers: [...DEFAULT_STUN, ...normaliseIceServers(await response.json())],
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
}

/**
 * Cached resolver.
 *
 * Credentials are reused until they approach expiry: a page load should not
 * cost a round trip to the provider, and providers rate-limit.
 */
export function createIceServerResolver(env = process.env, options = {}) {
  const provider = (env.TURN_PROVIDER ?? 'none').trim().toLowerCase();
  const ttlSeconds = Number(env.TURN_TTL_SECONDS ?? 86400) || 86400;
  const now = options.now ?? (() => Date.now());
  const fetchImpl = options.fetchProvider ?? fetchProviderCredentials;

  let cached = null;

  async function resolve() {
    if (cached && cached.expiresAt - REFRESH_MARGIN_SECONDS * 1000 > now()) return cached;

    if (provider === 'none' || provider === '') {
      cached = { iceServers: DEFAULT_STUN, expiresAt: now() + 3600_000, provider: 'none' };
      return cached;
    }

    try {
      const result =
        provider === 'shared-secret'
          ? mintSharedSecretCredentials({
              urls: parseUrls(env.TURN_URLS),
              secret: env.TURN_SHARED_SECRET,
              userId: env.TURN_USER_ID ?? 'aac',
              ttlSeconds,
              now: now(),
            })
          : await fetchImpl({
              url: env.TURN_CREDENTIALS_URL,
              method: env.TURN_CREDENTIALS_METHOD,
              authHeader: env.TURN_CREDENTIALS_AUTH_HEADER,
              body: env.TURN_CREDENTIALS_BODY,
              ttlSeconds,
            });

      cached = { ...result, provider };
      return cached;
    } catch (error) {
      // A TURN outage must not stop calls working on networks that never
      // needed a relay. Degrade to STUN, say so, and retry on the next request.
      console.error(`[ice] Could not obtain TURN credentials: ${error?.message ?? error}`);
      return {
        iceServers: DEFAULT_STUN,
        expiresAt: now() + 60_000,
        provider,
        degraded: true,
        detail: 'TURN credentials unavailable; falling back to STUN only.',
      };
    }
  }

  return { resolve, provider };
}
