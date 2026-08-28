/**
 * Type contract for the signalling hub.
 *
 * The implementation is plain JavaScript so that one file can back both the
 * bundled application origin and the standalone regional deployment without a
 * build step on the server.
 */

export interface HubBroadcaster {
  /** Fan a message out to other replicas serving the same room. */
  publish?(room: string, payload: string): void;
  close?(): Promise<void>;
}

export interface HubLogger {
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export interface PeerState {
  room: string | null;
  peerId: string | null;
}

export declare class SignalingHub {
  constructor(options?: { logger?: HubLogger });

  readonly roomCount: number;
  readonly peerCount: number;

  setBroadcaster(broadcaster: HubBroadcaster): void;

  /** Attach handlers to a newly accepted WebSocket. */
  handleConnection(socket: unknown): PeerState;

  /** Deliver a message that arrived from another replica. */
  deliverFromBroadcast(room: string, payload: string): void;

  /** Ping/pong sweep that terminates half-open connections. */
  startHeartbeat(wss: unknown, intervalMs?: number): ReturnType<typeof setInterval>;
}

/** Returns null when no REDIS_URL is set or ioredis is not installed. */
export declare function createRedisBroadcaster(
  url: string | undefined,
  hub: SignalingHub,
  logger?: HubLogger,
): Promise<HubBroadcaster | null>;
