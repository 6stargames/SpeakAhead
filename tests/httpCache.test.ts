import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cacheControl, contentEtag, etagFor, weakEtag } from '../http-cache.js';

/**
 * Regression tests for the defect that made several deploys invisible.
 *
 * The ETag was derived from size and mtime. The container build normalises
 * mtimes, and `sw.js` and `index.html` come out the same length every build
 * because the asset hashes they embed are fixed-length — so two different
 * deploys produced byte-identical ETags. Every conditional request got a 304 and
 * browsers kept a stale service worker and shell indefinitely, which looks like
 * "the fix didn't deploy" rather than a caching bug.
 */

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aac-cache-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('cacheControl', () => {
  it('revalidates the application shell', () => {
    expect(cacheControl('/dist/index.html')).toBe('no-cache');
    expect(cacheControl('/dist/manifest.webmanifest')).toBe('no-cache');
  });

  it('revalidates the service worker, so a bad one cannot become permanent', () => {
    expect(cacheControl('/dist/sw.js')).toBe('no-cache');
    expect(cacheControl('/dist/workbox-ebc1056e.js')).toBe('no-cache');
  });

  it('marks model weights immutable', () => {
    expect(cacheControl('/models/asr-v1.13.6/x.wasm')).toContain('immutable');
    expect(cacheControl('/models/asr-v1.13.6/x.data')).toContain('immutable');
    expect(cacheControl('/models/asr-v1.13.6/x.onnx')).toContain('immutable');
  });

  it('marks hashed build assets immutable', () => {
    expect(cacheControl('/dist/assets/index-C2tXj1zG.js')).toContain('immutable');
  });

  it('does not confuse a hashed asset with the service worker', () => {
    // sw.js has no content hash in its name and must stay revalidated.
    expect(cacheControl('/dist/sw.js')).toBe('no-cache');
  });
});

describe('contentEtag', () => {
  it('changes when content changes, even at identical size and mtime', async () => {
    const file = join(dir, 'sw.js');
    const stamp = new Date('2020-01-01T00:00:00Z');

    await writeFile(file, 'index-AAAAAAAA.js');
    await utimes(file, stamp, stamp);
    const before = await contentEtag(file, 'identity');

    // Exactly what a redeploy looks like here: same length, normalised mtime.
    await writeFile(file, 'index-BBBBBBBB.js');
    await utimes(file, stamp, stamp);
    const after = await contentEtag(file, 'identity');

    expect(before).not.toBe(after);
  });

  it('is stable for unchanged content, so 304s still work', async () => {
    const file = join(dir, 'stable.html');
    await writeFile(file, '<!doctype html>');
    expect(await contentEtag(file, 'identity')).toBe(await contentEtag(file, 'identity'));
  });

  it('distinguishes representations, not just files', async () => {
    const file = join(dir, 'rep.html');
    await writeFile(file, '<!doctype html>');
    expect(await contentEtag(file, 'br')).not.toBe(await contentEtag(file, 'identity'));
  });
});

describe('weakEtag', () => {
  it('varies by encoding so a cached Brotli body is not returned as identity', () => {
    expect(weakEtag(1024, 1_700_000_000_000, 'br')).not.toBe(weakEtag(1024, 1_700_000_000_000, 'identity'));
  });

  it('varies by size and mtime', () => {
    expect(weakEtag(1024, 1, 'identity')).not.toBe(weakEtag(2048, 1, 'identity'));
    expect(weakEtag(1024, 1, 'identity')).not.toBe(weakEtag(1024, 2, 'identity'));
  });
});

describe('etagFor', () => {
  it('hashes content for revalidated files', async () => {
    const file = join(dir, 'index.html');
    const stamp = new Date('2020-01-01T00:00:00Z');

    await writeFile(file, '<script src="/assets/index-AAAAAAAA.js"></script>');
    await utimes(file, stamp, stamp);
    const before = await etagFor(file, { size: 48, mtimeMs: 1, encoding: 'identity' });

    await writeFile(file, '<script src="/assets/index-BBBBBBBB.js"></script>');
    await utimes(file, stamp, stamp);
    const after = await etagFor(file, { size: 48, mtimeMs: 1, encoding: 'identity' });

    expect(before).not.toBe(after);
    expect(before.startsWith('W/')).toBe(false);
  });

  it('uses the cheap ETag for immutable files, which carry a hash in the URL', async () => {
    const etag = await etagFor('/models/asr-v1.13.6/model.data', {
      size: 190_951_044,
      mtimeMs: 1,
      encoding: 'identity',
    });
    // Never reads the file: hashing 190 MB per request would be absurd.
    expect(etag.startsWith('W/')).toBe(true);
  });

  it('hashes the served representation, not the original, when pre-compressed', async () => {
    const plain = join(dir, 'page.html');
    const brotli = join(dir, 'page.html.br');
    await writeFile(plain, 'plain body');
    await writeFile(brotli, 'brotli body');

    const etag = await etagFor(plain, {
      size: 10,
      mtimeMs: 1,
      encoding: 'br',
      servedPath: brotli,
    });
    expect(etag).toBe(await contentEtag(brotli, 'br'));
  });
});
