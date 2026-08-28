#!/usr/bin/env node
/**
 * Upload the model bundles to Cloud Storage with correct headers.
 *
 * Headers matter more than usual here:
 *
 *   • `.wasm` must be `application/wasm` or the browser refuses to
 *     stream-compile it, and the failure message points nowhere useful.
 *   • `.onnx` and `.data` must NOT be compressed. They are dense float
 *     matrices: compression buys almost nothing and costs CPU on every edge
 *     node. Setting Content-Encoding on them would also break range requests,
 *     which the service worker relies on to resume partial model reads offline.
 *   • Everything is immutable. These files never change under the same URL;
 *     a new model version gets a new prefix.
 *
 * Usage:
 *   MODELS_BUCKET=vpx4900-aac-models npm run upload:models
 */

import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = resolve(ROOT, 'public', 'models');

const BUCKET = process.env.MODELS_BUCKET;
const PROJECT = process.env.PROJECT_ID ?? 'vpx4900';
const PREFIX = process.env.MODELS_PREFIX ?? '';

const IMMUTABLE = 'public, max-age=31536000, immutable';

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.ort': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.wav': 'audio/wav',
};

/** Demo pages that ship inside the release archives and serve no purpose here. */
const SKIP = new Set(['index.html', 'app.js', 'app-asr.js', 'app-tts.js', 'app-vad.js']);

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  if (!BUCKET) {
    throw new Error('MODELS_BUCKET is not set. Example: MODELS_BUCKET=vpx4900-aac-models npm run upload:models');
  }

  const present = await stat(MODELS_DIR).catch(() => null);
  if (!present) throw new Error('public/models does not exist. Run `npm run fetch:models` first.');

  const files = [];
  for await (const path of walk(MODELS_DIR)) {
    const name = path.split('/').pop() ?? '';
    if (name === 'README.md' || name === '.gitkeep' || SKIP.has(name)) continue;
    files.push(path);
  }

  if (files.length === 0) {
    throw new Error('No model files found. Run `npm run fetch:models` first.');
  }

  const base = PREFIX ? `gs://${BUCKET}/${PREFIX.replace(/^\/+|\/+$/g, '')}` : `gs://${BUCKET}`;
  let uploaded = 0;
  let totalBytes = 0;

  process.stdout.write(`Uploading ${files.length} files to ${base}\n\n`);

  for (const path of files) {
    const relativePath = relative(MODELS_DIR, path);
    const extension = extname(path).toLowerCase();
    const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream';
    const size = (await stat(path)).size;

    process.stdout.write(`  ${relativePath.padEnd(46)} ${formatBytes(size).padStart(9)}  ${contentType}\n`);

    await run(
      'gcloud',
      [
        'storage',
        'cp',
        path,
        `${base}/${relativePath}`,
        `--content-type=${contentType}`,
        `--cache-control=${IMMUTABLE}`,
        `--project=${PROJECT}`,
        '--quiet',
      ],
      { maxBuffer: 1024 * 1024 * 16 },
    );

    uploaded += 1;
    totalBytes += size;
  }

  const publicBase = PREFIX
    ? `https://storage.googleapis.com/${BUCKET}/${PREFIX.replace(/^\/+|\/+$/g, '')}`
    : `https://storage.googleapis.com/${BUCKET}`;

  process.stdout.write(`\n✓ ${uploaded} files, ${formatBytes(totalBytes)}.\n\n`);
  process.stdout.write('Point the build at them:\n\n');
  process.stdout.write(`  VITE_SHERPA_ASR_BASE=${publicBase}/asr\n`);
  process.stdout.write(`  VITE_SHERPA_TTS_BASE=${publicBase}/tts\n`);
  process.stdout.write(`  VITE_SHERPA_VAD_BASE=${publicBase}/vad\n\n`);
  process.stdout.write('Keep COEP_MODE=credentialless while these are cross-origin.\n');
}

main().catch((error) => {
  process.stderr.write(`\n✕ ${error.message}\n`);
  process.exitCode = 1;
});
