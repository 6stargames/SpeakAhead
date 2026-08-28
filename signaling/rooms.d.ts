/** Transport-agnostic room membership and routing, shared by both signalling transports. */

export interface PeerSink {
  send(message: unknown): void;
}

export interface HubLoggerLike {
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export type JoinResult =
  | { ok: true; room: string; peers: string[] }
  | { ok: false; error: string };

export declare class Rooms {
  constructor(options?: { logger?: HubLoggerLike; maxPeers?: number });
  readonly roomCount: number;
  readonly peerCount: number;
  join(room: string, peerId: string, sink: PeerSink): JoinResult;
  leave(room: string, peerId: string): void;
  /** @returns whether the target peer was present locally. */
  relay(room: string, from: string, to: string, payload: unknown): boolean;
  deliverTo(room: string, peerId: string, message: unknown): void;
  broadcast(room: string, message: unknown): void;
  has(room: string, peerId: string): boolean;
  peersIn(room: string): string[];
}
