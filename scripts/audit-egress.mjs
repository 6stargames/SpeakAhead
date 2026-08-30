#!/usr/bin/env node
/**
 * BIPA egress audit.
 *
 * The architecture's central claim is that captured audio has no unreviewed
 * network path. Signed-in users explicitly enable one narrow exception: a
 * bounded, completed utterance may be posted to the same-origin GPT
 * transcription route. Continuous microphone streaming and microphone-to-peer
 * routing remain forbidden.
 *
 * So it is checked mechanically, on every build. Two kinds of check:
 *
 *   1. Structural — properties of the code that must hold (the microphone is
 *      never connected to the peer; the compliance rule set still contains the
 *      BIPA rule; capture worklets have no outputs).
 *   2. Heuristic — any call that sends data over the network whose arguments
 *      mention audio.
 *
 * The heuristic pass will occasionally be wrong. When it is, add an entry to
 * ALLOWLIST with a reason someone can evaluate — not a suppression comment that
 * disappears into the diff.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_DIRS = ['src', 'public/workers', 'public/worklets', 'signaling'];
const SCAN_FILES = ['server.js'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);

/** Calls that can move bytes off the device. */
const NETWORK_SINKS = [
  /\bfetch\s*\(/,
  /\bnavigator\.sendBeacon\s*\(/,
  /\bnew\s+XMLHttpRequest\b/,
  /\bnew\s+WebSocket\s*\(/,
  /\bnew\s+EventSource\s*\(/,
  /\.\s*addTrack\s*\(/,
  /\bnew\s+RTCDataChannel\b/,
];

/** Identifiers that plausibly denote raw audio. */
const AUDIO_TOKENS =
  /\b(samples?|waveform|pcm|float32array|audiobuffer|micstream|microphone|getusermedia|rawaudio|frame\.samples|channeldata|mediastreamtrack)\b/i;

const ALLOWLIST = [
  {
    file: 'src/speech/gptTranscription.ts',
    match: "fetch('/api/assist/transcription'",
    reason:
      'Signed-in accuracy pass: uploads one bounded completed-utterance WAV to the authenticated same-origin route after ONNX has already produced visible text. It is never a live stream and falls back to the local transcript.',
  },
  {
    file: 'src/webrtc/PeerSession.ts',
    match: 'addTrack',
    reason:
      'Adds only the MediaStreamAudioDestinationNode track produced by the TTS bus. The microphone belongs to a different AudioContext that owns no outbound sink, so it cannot reach this call.',
  },
  {
    file: 'src/audio/AudioGraph.ts',
    match: 'MediaStreamTrack',
    reason: 'Type annotation on the synthesised outbound track accessor. No transmission occurs here.',
  },
  {
    file: 'src/session/AacSession.ts',
    match: 'getUserMedia',
    reason: 'Acquires the microphone and hands it directly to the capture graph. The stream is never passed to a network API.',
  },
  {
    file: 'src/speech/asr/WebSpeechAsrProvider.ts',
    match: 'SpeechRecognition',
    reason:
      'The consented cloud fallback. It is disabled by default, reports offline:false, and the interface states plainly that this configuration is not BIPA-compliant.',
  },
];

const structuralChecks = [
  {
    id: 'no-microphone-to-peer-edge',
    description: 'The routing model never records an edge from the microphone to the peer.',
    async run(files) {
      const offenders = [];
      for (const [path, source] of files) {
        // Matches connect('microphone', 'peer') in any quoting or spacing.
        if (/connect\(\s*['"]microphone['"]\s*,\s*['"](peer|speakers)['"]/.test(source)) {
          offenders.push(path);
        }
      }
      return offenders.length === 0
        ? { ok: true }
        : { ok: false, detail: `Microphone routed to an output in: ${offenders.join(', ')}` };
    },
  },
  {
    id: 'bipa-rule-present',
    description: 'The compliance rule set still contains the BIPA microphone rule.',
    async run(files) {
      const routing = files.get('src/audio/routing.ts');
      if (!routing) return { ok: false, detail: 'src/audio/routing.ts is missing.' };
      const hasRule = routing.includes('BIPA/mic-never-leaves-device');
      const hasAssertion = /!graph\.pathExists\(\s*'microphone'\s*,\s*'peer'\s*\)/.test(routing);
      return hasRule && hasAssertion
        ? { ok: true }
        : { ok: false, detail: 'The BIPA rule or its reachability assertion has been removed or renamed.' };
    },
  },
  {
    id: 'capture-worklet-has-no-outputs',
    description: 'Capture worklet nodes are constructed with zero outputs, so they cannot feed any sink.',
    async run(files) {
      const graph = files.get('src/audio/AudioGraph.ts');
      if (!graph) return { ok: false, detail: 'src/audio/AudioGraph.ts is missing.' };
      return /numberOfOutputs:\s*0/.test(graph)
        ? { ok: true }
        : { ok: false, detail: 'The capture node no longer declares numberOfOutputs: 0.' };
    },
  },
  {
    id: 'asr-worker-has-no-network-sink',
    description: 'The recognition worker contains no network call of any kind.',
    async run(files) {
      const worker = files.get('public/workers/sherpa-asr-worker.js');
      if (!worker) return { ok: false, detail: 'The ASR worker is missing.' };
      const withoutComments = worker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
      const offending = [/\bfetch\s*\(/, /\bnew\s+WebSocket\b/, /\bXMLHttpRequest\b/, /sendBeacon/].filter((pattern) =>
        pattern.test(withoutComments),
      );
      return offending.length === 0
        ? { ok: true }
        : { ok: false, detail: 'The recognition worker now contains a network call. Audio frames live in this scope.' };
    },
  },
  {
    id: 'direct-worklet-to-asr-bridge',
    description: 'Microphone frames have a page-independent MessagePort path to the on-device recogniser.',
    async run(files) {
      const graph = files.get('src/audio/AudioGraph.ts') ?? '';
      const worklet = files.get('public/worklets/aac-capture-worklet.js') ?? '';
      const worker = files.get('public/workers/sherpa-asr-worker.js') ?? '';
      const session = files.get('src/session/AacSession.ts') ?? '';
      const complete =
        graph.includes("type: 'bind-recognizer-port'") &&
        worklet.includes('this.recognizerPort.postMessage') &&
        worker.includes("case 'bind-audio-port'") &&
        worker.includes('handleDirectFrame') &&
        session.includes('directRecognizerAttached(frame.channel)');
      return complete
        ? { ok: true }
        : { ok: false, detail: 'The direct capture-to-recogniser bridge is incomplete.' };
    },
  },
  {
    id: 'assertion-runs-on-microphone-attach',
    description: 'Attaching the microphone asserts the compliance invariants rather than trusting them.',
    async run(files) {
      const graph = files.get('src/audio/AudioGraph.ts');
      if (!graph) return { ok: false, detail: 'src/audio/AudioGraph.ts is missing.' };
      // Anchor on the method *declaration*, not the call to detachMicrophone()
      // that attachMicrophone makes on its first line.
      const start = graph.indexOf('async attachMicrophone');
      const end = graph.indexOf('\n  detachMicrophone(): void', start);
      const attachBody = graph.slice(start, end === -1 ? undefined : end);
      return attachBody.includes('assertCompliance')
        ? { ok: true }
        : { ok: false, detail: 'attachMicrophone no longer calls assertCompliance.' };
    },
  },
];

async function* walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (EXTENSIONS.has(extname(entry.name))) yield path;
  }
}

function isAllowlisted(file, line) {
  return ALLOWLIST.find((entry) => file === entry.file && line.includes(entry.match));
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

async function main() {
  /** @type {Map<string, string>} */
  const files = new Map();

  for (const directory of SCAN_DIRS) {
    for await (const path of walk(resolve(ROOT, directory))) {
      files.set(relative(ROOT, path), await readFile(path, 'utf8'));
    }
  }
  for (const file of SCAN_FILES) {
    files.set(file, await readFile(resolve(ROOT, file), 'utf8').catch(() => ''));
  }

  const failures = [];
  const notes = [];

  process.stdout.write('BIPA egress audit\n=================\n\nStructural checks:\n');
  for (const check of structuralChecks) {
    const result = await check.run(files);
    process.stdout.write(`  ${result.ok ? '✓' : '✕'} ${check.id} — ${check.description}\n`);
    if (!result.ok) failures.push(`${check.id}: ${result.detail}`);
  }

  process.stdout.write('\nNetwork call sites mentioning audio:\n');
  let siteCount = 0;

  for (const [file, source] of files) {
    const lines = stripComments(source).split('\n');
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (!NETWORK_SINKS.some((pattern) => pattern.test(line))) return;
      if (!AUDIO_TOKENS.test(line)) return;

      siteCount += 1;
      const allowed = isAllowlisted(file, line);
      if (allowed) {
        notes.push(`  ○ ${file}:${index + 1} — allowlisted: ${allowed.reason}`);
      } else {
        failures.push(
          `${file}:${index + 1} sends audio-shaped data over the network:\n      ${trimmed}\n` +
            '      If this is safe, add it to ALLOWLIST in scripts/audit-egress.mjs with a reason.',
        );
      }
    });
  }

  if (siteCount === 0) process.stdout.write('  none found\n');
  for (const note of notes) process.stdout.write(`${note}\n`);

  process.stdout.write(`\nScanned ${files.size} files.\n`);

  if (failures.length > 0) {
    process.stdout.write(`\n✕ ${failures.length} problem(s):\n\n`);
    for (const failure of failures) process.stdout.write(`  • ${failure}\n\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('\n✓ No unreviewed path from captured audio to the network.\n');
}

main().catch((error) => {
  process.stderr.write(`[audit] ${error.message}\n`);
  process.exitCode = 1;
});
