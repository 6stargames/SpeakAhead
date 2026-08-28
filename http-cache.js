/**
 * Caching policy for the origin.
 *
 * Extracted from server.js so the rules can be tested directly. Getting them
 * subtly wrong is expensive and hard to see: a bad ETag does not throw, it just
 * makes deploys silently invisible to every returning browser.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

/** Model weights and hashed build assets never change under the same URL. */
export const IMMUTABLE_EXTENSIONS = new Set(['.wasm', '.onnx', '.data', '.bin', '.ort', '.woff', '.woff2']);

const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

/** The service worker must be revalidated, or a bad one becomes permanent. */
const ALWAYS_REVALIDATE = /(?:^|[/\\])(sw|registerSW|workbox-[^/\\]*)\.js$/;

export function cacheControl(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.html' || filePath.endsWith('.webmanifest')) return 'no-cache';
  if (ALWAYS_REVALIDATE.test(filePath)) return 'no-cache';
  if (IMMUTABLE_EXTENSIONS.has(extension) || HASHED_ASSET.test(filePath)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

/**
 * ETag for a revalidated resource, derived from its content.
 *
 * Size and mtime are not a content identifier here, and assuming they were cost
 * a genuinely confusing afternoon. The container build normalises file mtimes,
 * and `sw.js` and `index.html` come out the same length every build because the
 * asset hashes they embed are fixed-length. Two different deploys therefore
 * produced byte-identical ETags: every conditional request got a 304, and
 * browsers kept serving a stale service worker and application shell
 * indefinitely. That presents as "the fix didn't deploy", not as a caching bug,
 * which is what makes it so costly.
 *
 * Not memoised, deliberately. Any cache key cheap enough to be worth having
 * would be size and mtime — the very pair that is untrustworthy. These files
 * are a few kilobytes; hashing one costs microseconds.
 */
export async function contentEtag(filePath, encoding) {
  const digest = createHash('sha1').update(await readFile(filePath)).digest('hex').slice(0, 20);
  return `"${digest}-${encoding}"`;
}

/**
 * ETag for an immutable resource. Cheap, because the URL already carries a
 * content hash — if the bytes change, the URL changes.
 *
 * The encoding is part of it either way: a client holding the Brotli body and
 * later asking without `Accept-Encoding: br` must not be handed a 304 for a
 * representation it cannot decode.
 */
export function weakEtag(size, mtimeMs, encoding) {
  return `W/"${size.toString(16)}-${Math.round(mtimeMs).toString(16)}-${encoding}"`;
}

/** Choose the right ETag strategy for a file, given its caching policy. */
export async function etagFor(filePath, { size, mtimeMs, encoding, servedPath }) {
  return cacheControl(filePath) === 'no-cache'
    ? contentEtag(servedPath ?? filePath, encoding)
    : weakEtag(size, mtimeMs, encoding);
}
