/**
 * HTTP long-polling signalling, used by the application origin because
 * Firebase App Hosting's edge refuses WebSocket upgrades.
 */

import type { HubLoggerLike, JoinResult } from './rooms.js';

export interface PollResult {
  ok: boolean;
  messages?: unknown[];
  error?: string;
}

export declare class HttpSignalingHub {
  constructor(options?: { logger?: HubLoggerLike });
  readonly roomCount: number;
  readonly peerCount: number;
  join(room: string, peerId: string): JoinResult;
  send(room: string, from: string, to: string, payload: unknown): { ok: boolean; delivered?: boolean; error?: string };
  leave(room: string, peerId: string): { ok: true };
  poll(room: string, peerId: string, options?: { timeoutMs?: number }): Promise<PollResult>;
  close(): void;
}

export declare function readJsonBody(req: unknown): Promise<Record<string, unknown>>;
