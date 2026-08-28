import type { PredictionContext, PredictionSource } from './types';
import { expandShorthand } from './heuristic';

/**
 * Chrome's built-in on-device language model (the Prompt API), used when the
 * browser exposes it.
 *
 * This tier matters because it is the only *generative* option that keeps the
 * BIPA guarantee intact: the model weights are on the device, so a transcript
 * of a medical conversation never becomes an outbound request. If it is absent
 * the ladder simply falls through to the rule engine.
 */

interface LanguageModelSession {
  prompt(input: string): Promise<string>;
  destroy?(): void;
}

interface LanguageModelNamespace {
  availability?: () => Promise<string>;
  capabilities?: () => Promise<{ available?: string }>;
  create: (options?: Record<string, unknown>) => Promise<LanguageModelSession>;
}

function findNamespace(): LanguageModelNamespace | null {
  const scope = globalThis as unknown as {
    LanguageModel?: LanguageModelNamespace;
    ai?: { languageModel?: LanguageModelNamespace };
  };
  if (scope.LanguageModel && typeof scope.LanguageModel.create === 'function') return scope.LanguageModel;
  if (scope.ai?.languageModel && typeof scope.ai.languageModel.create === 'function') {
    return scope.ai.languageModel;
  }
  return null;
}

/**
 * A prompt whose correct answer is unmistakable, and whose text is distinctive
 * enough that an echo is obvious.
 *
 * Some browsers ship a *stub* Prompt API that reports itself available and then
 * returns the prompt back with a preamble. Trusting `availability()` alone put
 * "On-device model is not available in Chromium, this API is just echoing back
 * the input:" into the composition buffer during testing — which, on a device
 * that speaks for someone, is the worst possible failure. So the tier proves
 * itself before it is trusted.
 */
const CANARY_PROMPT = 'Respond with a single word and nothing else: READY';

const META_RESPONSE =
  /\b(not available|just echoing|echoing back|placeholder|stub implementation|language model api|no model (is )?(available|loaded))\b/i;

/** True when the response merely parrots a chunk of the prompt back. */
export function looksLikeEcho(prompt: string, response: string): boolean {
  const needle = prompt.slice(0, Math.min(28, prompt.length)).trim();
  if (needle.length >= 12 && response.includes(needle)) return true;
  return META_RESPONSE.test(response);
}

/**
 * Guard against a model that returns something unusable in place of the user's
 * words. A refusal, an apology or a wall of commentary must never silently
 * overwrite what someone typed.
 */
export function isPlausibleExpansion(shorthand: string, candidate: string): boolean {
  const text = candidate.trim();
  if (text.length === 0) return false;
  if (META_RESPONSE.test(text)) return false;
  if (text.includes(':') && /\b(input|output|prompt|response)\b/i.test(text)) return false;

  // An expansion adds grammar, not paragraphs. Ten times the input, or 400
  // characters, means the model has started explaining itself.
  const limit = Math.max(120, shorthand.trim().length * 10);
  return text.length <= Math.min(400, limit);
}

const SYSTEM_PROMPT =
  'You assist someone using an augmentative and alternative communication device. ' +
  'They can only produce a few words at a time, so you write the words they would say. ' +
  'Always write in the first person as that person. Keep replies short, natural and polite. ' +
  'Never add commentary, quotation marks, numbering or explanation.';

function formatTranscript(context: PredictionContext): string {
  if (context.turns.length === 0) return '(no conversation yet)';
  return context.turns
    .map((turn) => `${turn.source === 'user' ? 'Me' : 'Them'}: ${turn.text}`)
    .join('\n');
}

/** Models drift from the requested format; salvage the usable lines. */
function parseSuggestions(raw: string): string[] {
  return raw
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .map((line) => line.replace(/^["'“”]|["'“”]$/g, '').trim())
    .filter((line) => line.length > 0 && line.length <= 140 && !META_RESPONSE.test(line))
    .slice(0, 3);
}

let cachedSession: LanguageModelSession | null = null;
let sessionPromise: Promise<LanguageModelSession> | null = null;

async function getSession(): Promise<LanguageModelSession> {
  if (cachedSession) return cachedSession;
  if (sessionPromise) return sessionPromise;

  const namespace = findNamespace();
  if (!namespace) throw new Error('No on-device language model in this browser.');

  sessionPromise = namespace
    .create({ initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }] })
    .then((session) => {
      cachedSession = session;
      sessionPromise = null;
      return session;
    })
    .catch((error: unknown) => {
      sessionPromise = null;
      throw error;
    });

  return sessionPromise;
}

export function destroyOnDeviceSession(): void {
  cachedSession?.destroy?.();
  cachedSession = null;
  probeResult = null;
}

/** Cached so the canary costs one inference per page load, not one per turn. */
let probeResult: boolean | null = null;

async function proveItWorks(): Promise<boolean> {
  if (probeResult !== null) return probeResult;

  try {
    const session = await getSession();
    const response = await session.prompt(CANARY_PROMPT);

    if (looksLikeEcho(CANARY_PROMPT, response)) {
      console.info('[aac] The browser exposes a stub Prompt API that echoes its input. Ignoring it.');
      probeResult = false;
    } else {
      probeResult = /\bready\b/i.test(response);
      if (!probeResult) {
        console.info('[aac] On-device model did not answer the capability probe. Ignoring it.');
      }
    }
  } catch {
    probeResult = false;
  }

  if (!probeResult) destroyOnDeviceSession();
  return probeResult;
}

export const onDeviceModelPredictionSource: PredictionSource = {
  id: 'on-device-model',
  label: 'On-device language model',

  async available() {
    const namespace = findNamespace();
    if (!namespace) return false;
    try {
      if (namespace.availability) {
        const state = await namespace.availability();
        if (state !== 'available' && state !== 'readily' && state !== 'downloadable') return false;
      } else if (namespace.capabilities) {
        const capabilities = await namespace.capabilities();
        if (capabilities.available !== 'readily' && capabilities.available !== 'after-download') return false;
      }
      // Declared availability is not enough — make it answer.
      return await proveItWorks();
    } catch {
      return false;
    }
  },

  async predict(context) {
    const session = await getSession();
    const response = await session.prompt(
      `Conversation so far:\n${formatTranscript(context)}\n\n` +
        'Write exactly three different short replies I could say next. ' +
        'One reply per line, nothing else.',
    );
    if (looksLikeEcho(formatTranscript(context), response)) {
      destroyOnDeviceSession();
      throw new Error('Model echoed the prompt instead of answering.');
    }

    const suggestions = parseSuggestions(response);
    if (suggestions.length === 0) throw new Error('Model returned no usable suggestions.');
    return suggestions;
  },

  async expand(shorthand, context) {
    const session = await getSession();
    const response = await session.prompt(
      `Conversation so far:\n${formatTranscript(context)}\n\n` +
        `I typed these keywords: "${shorthand}"\n` +
        'Rewrite them as one complete, polite sentence I would say out loud. ' +
        'Reply with the sentence only.',
    );
    const sentence = response.trim().replace(/^["'“”]|["'“”]$/g, '').split(/\r?\n/)[0]?.trim() ?? '';

    // A model that returns something unusable must never overwrite the user's
    // words. Fall back to the deterministic expander instead.
    if (!isPlausibleExpansion(shorthand, sentence)) {
      destroyOnDeviceSession();
      return expandShorthand(shorthand);
    }
    return sentence;
  },
};
