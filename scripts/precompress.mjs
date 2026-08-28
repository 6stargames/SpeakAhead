#!/usr/bin/env node
/**
 * Pre-compress build output.
 *
 * The specification's asset policy, implemented: Brotli and gzip for text and
 * WebAssembly, nothing at all for ONNX weights. Model files are dense float
 * matrices — they do not shrink, and compressing them on the fly only spikes
 * CPU at the edge and delays first audio. `server.js` reads these siblings and
 * serves them when the client advertises support.
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

const COMPRESSIBLE = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.webmanifest', '.map', '.wasm',
]);

/** Deliberately never compressed — see the module comment. */
const INCOMPRESSIBLE = new Set(['.onnx', '.data', '.bin', '.ort', '.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2']);

const MIN_BYTES = 1024;

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

async function main() {
  const distExists = await stat(DIST).catch(() => null);
  if (!distExists) {
    process.stdout.write('[precompress] No dist/ directory; nothing to do.\n');
    return;
  }

  let compressed = 0;
  let originalTotal = 0;
  let brotliTotal = 0;
  let skippedIncompressible = 0;

  for await (const path of walk(DIST)) {
    const extension = extname(path).toLowerCase();
    if (extension === '.br' || extension === '.gz') continue;

    if (INCOMPRESSIBLE.has(extension)) {
      skippedIncompressible += 1;
      continue;
    }
    if (!COMPRESSIBLE.has(extension)) continue;

    const source = await readFile(path);
    if (source.length < MIN_BYTES) continue;

    const [br, gz] = await Promise.all([
      brotli(source, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 11,
          [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
        },
      }),
      gzipAsync(source, { level: 9 }),
    ]);

    // A compressed file larger than the original is worse than useless.
    if (br.length < source.length * 0.95) {
      await writeFile(`${path}.br`, br);
      brotliTotal += br.length;
      originalTotal += source.length;
      compressed += 1;
    }
    if (gz.length < source.length * 0.95) {
      await writeFile(`${path}.gz`, gz);
    }
  }

  const ratio = originalTotal > 0 ? (1 - brotliTotal / originalTotal) * 100 : 0;
  process.stdout.write(
    `[precompress] ${compressed} files, ${(originalTotal / 1024).toFixed(0)} kB → ` +
      `${(brotliTotal / 1024).toFixed(0)} kB brotli (${ratio.toFixed(0)}% smaller). ` +
      `${skippedIncompressible} model/binary files left uncompressed by design.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`[precompress] ${error.message}\n`);
  process.exitCode = 1;
});
