#!/usr/bin/env node
/**
 * Download the Sherpa-ONNX WebAssembly bundles into `public/models/`.
 *
 * The weights are hundreds of megabytes of dense float matrices. They do not
 * belong in version control, so this script is how a clone becomes a working
 * device. Everything it fetches is a published release artefact with a pinned
 * version — nothing is resolved at runtime.
 *
 * Usage:
 *   npm run fetch:models              # English ASR + a TTS voice + Silero VAD
 *   npm run fetch:models -- asr       # just one bundle
 *   npm run fetch:models -- --list
 *   SHERPA_VERSION=v1.13.6 npm run fetch:models
 */

import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = resolve(ROOT, 'public', 'models');

const RELEASE_ROOT = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const DEFAULT_VERSION = process.env.SHERPA_VERSION ?? 'v1.13.6';

/**
 * The default set. Each bundle pins its own release, because they do not all
 * ship in every one.
 *
 * ASR is the streaming English Zipformer the specification names: it produces
 * words while you are still speaking, which is what makes dictation usable
 * rather than merely possible.
 *
 * TTS is Piper VITS, also as the specification names it. This matters more than
 * it looks. The newest releases ship `pocket-tts` and `zipvoice` instead, and
 * both are *voice cloning* models: they derive a voice embedding from a
 * reference recording and fail with `reference_sample_rate 0 is invalid` if you
 * simply ask them to speak. VITS is speaker-based — `sid` picks one of the
 * LibriTTS-R voices — which is what a communication device needs out of the box.
 */
const BUNDLES = {
  asr: {
    version: DEFAULT_VERSION,
    archive: `sherpa-onnx-wasm-simd-${DEFAULT_VERSION}-en-asr-zipformer.tar.bz2`,
    approxMb: 167,
    description: 'Streaming English Zipformer transducer (real-time recognition)',
  },
  tts: {
    // v1.12.37 deliberately, not the newest.
    //
    // From v1.13 the TTS glue is built with -sEXPORT_ES6=1 and pthreads, and
    // that build stalls forever during nested pthread bootstrap — the bundle's
    // own demo page hangs at "Downloading data... 100%" with no error, so it is
    // not something an integration can work around. This release is the classic
    // single-threaded build, which is also the shape the ASR bundle still uses.
    version: 'v1.12.37',
    archive: 'sherpa-onnx-wasm-simd-1.12.36-vits-piper-en_US-libritts_r-medium.tar.bz2',
    approxMb: 81,
    description: 'Piper VITS English (US), multi-speaker — routable to a WebRTC peer',
  },
  vad: {
    version: DEFAULT_VERSION,
    archive: `sherpa-onnx-wasm-simd-${DEFAULT_VERSION}-vad.tar.bz2`,
    approxMb: 3,
    description: 'Silero voice activity detection',
  },
  speaker: {
    // A plain .onnx file rather than a WASM bundle: it runs via
    // onnxruntime-web, which ships with the app itself.
    version: 'v1',
    file: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
    filename: 'campplus-en-voxceleb.onnx',
    approxMb: 29,
    description: 'CAM++ speaker verification (3D-Speaker, VoxCeleb English) — voice attribution',
  },
};

/**
 * Install path for a bundle.
 *
 * The version is part of the directory, and that is load-bearing rather than
 * tidy. Model files are served with `Cache-Control: immutable`, which promises
 * the bytes at a URL will never change. Swapping a bundle in place breaks that
 * promise, and the symptom is brutal: browsers and the CDN keep serving the old
 * model for a year while the code expects the new one. A new bundle gets a new
 * URL instead.
 */
function targetDir(key, bundle) {
  return `${key}-${bundle.version}`;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function exists(path) {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

async function download(url, destination) {
  process.stdout.write(`  fetching ${url}\n`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  let lastReport = 0;

  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    // Throttle progress output: a fast connection would otherwise emit
    // thousands of lines into a CI log.
    if (now - lastReport < 1000) return;
    lastReport = now;
    const percent = total > 0 ? ` (${((received / total) * 100).toFixed(0)}%)` : '';
    process.stdout.write(`  …${formatBytes(received)}${percent}\n`);
  });

  await pipeline(source, createWriteStream(destination));
  return received;
}

/**
 * Extract, then flatten the single top-level directory the archives contain, so
 * the served layout is `/models/asr/sherpa-onnx-wasm-main-asr.js` rather than
 * `/models/asr/sherpa-onnx-wasm-simd-v1.13.6-en-asr-zipformer/…`.
 */
async function extract(archivePath, targetDir) {
  const staging = `${targetDir}.staging`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  process.stdout.write('  extracting…\n');
  await run('tar', ['-xjf', archivePath, '-C', staging], { maxBuffer: 1024 * 1024 * 32 });

  const entries = await readdir(staging, { withFileTypes: true });
  const inner = entries.length === 1 && entries[0].isDirectory() ? resolve(staging, entries[0].name) : staging;

  await rm(targetDir, { recursive: true, force: true });
  await rename(inner, targetDir);
  await rm(staging, { recursive: true, force: true });
}

async function fetchBundle(key) {
  const bundle = BUNDLES[key];
  if (!bundle) throw new Error(`Unknown bundle "${key}". Known: ${Object.keys(BUNDLES).join(', ')}`);

  const directory = targetDir(key, bundle);
  const installPath = resolve(MODELS_DIR, directory);

  // Single-file models download straight into place, no archive to unpack.
  if (bundle.file) {
    const filePath = resolve(installPath, bundle.filename);
    if (await exists(filePath)) {
      process.stdout.write(`✓ ${key} already installed at public/models/${directory}\n`);
      return;
    }
    process.stdout.write(`\n▸ ${key} — ${bundle.description} (~${bundle.approxMb} MB)\n`);
    await mkdir(installPath, { recursive: true });
    const size = await download(bundle.file, filePath);
    process.stdout.write(`  downloaded ${formatBytes(size)}\n`);
    process.stdout.write(`✓ ${key} installed at public/models/${directory}\n`);
    return;
  }

  const marker = resolve(installPath, `sherpa-onnx-wasm-main-${key}.wasm`);

  if (await exists(marker)) {
    process.stdout.write(`✓ ${key} already installed at public/models/${directory}\n`);
    return;
  }

  process.stdout.write(`\n▸ ${key} — ${bundle.description} (~${bundle.approxMb} MB)\n`);

  await mkdir(MODELS_DIR, { recursive: true });
  const archivePath = resolve(MODELS_DIR, bundle.archive);

  try {
    const size = await download(`${RELEASE_ROOT}/${bundle.version}/${bundle.archive}`, archivePath);
    process.stdout.write(`  downloaded ${formatBytes(size)}\n`);
    await extract(archivePath, installPath);
    process.stdout.write(`✓ ${key} installed at public/models/${directory}\n`);
  } finally {
    await rm(archivePath, { force: true });
  }
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');

  if (args.includes('--list')) {
    process.stdout.write('Sherpa-ONNX WebAssembly bundles\n\n');
    for (const [key, bundle] of Object.entries(BUNDLES)) {
      process.stdout.write(
        `  ${key.padEnd(5)} ${bundle.version.padEnd(8)} ~${String(bundle.approxMb).padStart(4)} MB  ${bundle.description}\n`,
      );
    }
    process.stdout.write('\nOther variants: https://github.com/k2-fsa/sherpa-onnx/releases\n');
    return;
  }

  const requested = args.length > 0 ? args : Object.keys(BUNDLES);
  const total = requested.reduce((sum, key) => sum + (BUNDLES[key]?.approxMb ?? 0), 0);
  process.stdout.write(`Installing ${requested.join(', ')} (~${total} MB) from Sherpa-ONNX releases.\n`);

  for (const key of requested) {
    await fetchBundle(key);
  }

  process.stdout.write('\nDone. Point the build at these paths:\n\n');
  for (const key of requested) {
    const bundle = BUNDLES[key];
    if (bundle) {
      process.stdout.write(`  VITE_SHERPA_${key.toUpperCase()}_BASE=/models/${targetDir(key, bundle)}\n`);
    }
  }
  process.stdout.write('\nRestart the dev server so the new files are served.\n');
}

main().catch((error) => {
  process.stderr.write(`\n✕ ${error.message}\n`);
  process.stderr.write('\nIf the archive name has changed, run with --list or check the release page.\n');
  process.exitCode = 1;
});
