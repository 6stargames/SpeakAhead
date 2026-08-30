declare module 'cloudflare:workers' {
  export interface R2Bucket {
    get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null>;
    put(
      key: string,
      value: ArrayBuffer | string,
      options?: {
        httpMetadata?: { contentType?: string; cacheControl?: string };
      },
    ): Promise<unknown>;
  }

  export const env: { THEME_IMAGES: R2Bucket };
}
