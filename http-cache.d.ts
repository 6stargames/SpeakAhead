/** Caching policy for the origin. Extracted from server.js so it can be tested. */

export declare const IMMUTABLE_EXTENSIONS: Set<string>;

/** `no-cache` for the shell and service worker; `immutable` for hashed assets and models. */
export declare function cacheControl(filePath: string): string;

/** Content-derived ETag. Size and mtime are not trustworthy here — see the implementation. */
export declare function contentEtag(filePath: string, encoding: string): Promise<string>;

/** Cheap ETag for immutable resources, which already carry a hash in their URL. */
export declare function weakEtag(size: number, mtimeMs: number, encoding: string): string;

export declare function etagFor(
  filePath: string,
  options: { size: number; mtimeMs: number; encoding: string; servedPath?: string },
): Promise<string>;
