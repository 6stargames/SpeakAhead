/** Type contract for the runtime ICE credential resolver (plain JS, Node-only). */

export interface IceServerDescriptor {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceResolution {
  iceServers: IceServerDescriptor[];
  expiresAt: number;
  provider?: string;
  degraded?: boolean;
  detail?: string;
}

export declare function mintSharedSecretCredentials(options: {
  urls: string[];
  secret: string;
  userId?: string;
  ttlSeconds?: number;
  now?: number;
}): IceResolution;

export declare function normaliseIceServers(payload: unknown): IceServerDescriptor[];

/** Accepts a full header line or a bare token (treated as a bearer). */
export declare function buildAuthHeaders(authHeader: string | undefined): Record<string, string>;

export declare function createIceServerResolver(
  env?: Record<string, string | undefined>,
  options?: {
    now?: () => number;
    fetchProvider?: (options: {
      url?: string;
      method?: string;
      authHeader?: string;
      body?: string;
      ttlSeconds: number;
    }) => Promise<IceResolution>;
  },
): { resolve: () => Promise<IceResolution>; provider: string };
