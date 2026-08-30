declare module 'cloudflare:workers' {
  export interface R2ObjectBody {
    body: ReadableStream<Uint8Array>;
    etag?: string;
  }

  export interface R2Conditional {
    etagMatches?: string;
    etagDoesNotMatch?: string;
  }

  export interface R2Bucket {
    get(key: string): Promise<R2ObjectBody | null>;
    put(
      key: string,
      value: ArrayBuffer | string,
      options?: {
        onlyIf?: R2Conditional | Headers;
        httpMetadata?: { contentType?: string; cacheControl?: string };
      },
    ): Promise<{ etag?: string } | null>;
    delete(key: string): Promise<void>;
  }

  export const env: { THEME_IMAGES: R2Bucket };
}
