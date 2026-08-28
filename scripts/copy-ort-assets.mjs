#!/usr/bin/env node
/**
 * Copy the onnxruntime-web runtime (wasm + loader) into `public/ort/`.
 *
 * The package does not export these files through its `exports` map, so they
 * cannot be `?url`-imported by the bundler; they have to be served as plain
 * same-origin assets. The speaker-embedding worker points
 * `ort.env.wasm.wasmPaths` here, and the service worker's *.wasm runtime rule
 * makes them available offline after first use, like every model file.
 *
 * Runs on postinstall, and again before dev/build in case node_modules was
 * updated in place.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
const TARGET = resolve(ROOT, 'public', 'ort');

const FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];

async function main() {
  await mkdir(TARGET, { recursive: true });
  for (const file of FILES) {
    const from = resolve(SOURCE, file);
    const to = resolve(TARGET, file);
    const [source, target] = await Promise.all([
      stat(from),
      stat(to).catch(() => null),
    ]);
    if (target && target.size === source.size && target.mtimeMs >= source.mtimeMs) continue;
    await copyFile(from, to);
    process.stdout.write(`copied ${file} (${(source.size / 1024 / 1024).toFixed(1)} MB) → public/ort/\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`✕ ${error.message}\n`);
  process.exitCode = 1;
});
