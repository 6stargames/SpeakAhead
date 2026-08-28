import { config, DEFAULT_ICE_SERVERS } from '@/lib/env';

export interface IceConfiguration {
  readonly iceServers: RTCIceServer[];
  readonly provider: string;
  readonly expiresAt: number;
  readonly degraded?: boolean;
  readonly detail?: string;
}

interface IceServerResponse {
  iceServers?: unknown;
  provider?: unknown;
  expiresAt?: unknown;
  degraded?: unknown;
  detail?: unknown;
}

const ENDPOINT = '/api/ice-servers';
/** Refresh a little before the credentials actually lapse. */
const REFRESH_MARGIN_MS = 60_000;

let cached: IceConfiguration | null = null;
let inFlight: Promise<IceConfiguration> | null = null;

function fallback(detail: string): IceConfiguration {
  return {
    iceServers: config.iceServers.length > 0 ? [...config.iceServers] : [...DEFAULT_ICE_SERVERS],
    provider: 'build-time',
    expiresAt: Date.now() + 60_000,
    degraded: true,
    detail,
  };
}

function parse(payload: IceServerResponse): IceConfiguration | null {
  if (!Array.isArray(payload.iceServers) || payload.iceServers.length === 0) return null;
  return {
    iceServers: payload.iceServers as RTCIceServer[],
    provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
    expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : Date.now() + 3_600_000,
    degraded: payload.degraded === true,
    detail: typeof payload.detail === 'string' ? payload.detail : undefined,
  };
}

/**
 * Fetch ICE servers from the origin.
 *
 * TURN credentials are minted server-side and are short-lived, so they are
 * requested when a call is about to start rather than baked into the bundle at
 * build time. If the endpoint is unreachable — an older deployment, a static
 * host, an offline device — this falls back to the build-time configuration,
 * which is STUN-only by default. Calls then work on ordinary networks and fail
 * behind symmetric NAT, which the Check connectivity panel reports honestly.
 */
export async function loadIceConfiguration(options: { force?: boolean } = {}): Promise<IceConfiguration> {
  if (!options.force && cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch(ENDPOINT, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) return fallback(`ICE endpoint responded ${response.status}.`);

      const parsed = parse((await response.json()) as IceServerResponse);
      if (!parsed) return fallback('ICE endpoint returned no usable servers.');

      cached = parsed;
      return parsed;
    } catch (error) {
      return fallback(
        error instanceof Error ? `ICE endpoint unreachable: ${error.message}` : 'ICE endpoint unreachable.',
      );
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test seam and hard reset, e.g. after a failed call. */
export function clearIceConfigurationCache(): void {
  cached = null;
  inFlight = null;
}
