import type { PredictionContext, PredictionSource } from './types';

/**
 * Deterministic, fully offline prediction and expansion.
 *
 * This is not a language model and does not pretend to be one. It is a rule
 * system over a small AAC-relevant vocabulary, and it exists because the
 * alternative - a device that offers nothing when no agent is attached and no
 * network is available - is unacceptable. It runs in microseconds, produces the
 * same output every time, and never leaves the device.
 *
 * The vocabulary leans on core AAC needs (comfort, medical, basic requests),
 * because those are the utterances whose delay costs the most.
 */

interface Intent {
  readonly id: string;
  readonly pattern: RegExp;
  readonly responses: readonly [string, string, string];
}

/** Ordered: first match wins, so specific patterns sit above general ones. */
const RESPONSE_INTENTS: readonly Intent[] = [
  {
    id: 'pain-check',
    pattern: /\b(in pain|hurting|does it hurt|any pain|comfortable|how('s| is) your pain)\b/i,
    responses: ['Yes, I am in pain.', 'No, I am comfortable.', 'Could I have my medication, please?'],
  },
  {
    id: 'drink-offer',
    pattern: /\b(drink|thirsty|water|coffee|tea|juice)\b/i,
    responses: ['Water, please.', "I'll have iced tea.", 'Nothing for me, thanks.'],
  },
  {
    id: 'food-offer',
    pattern: /\b(eat|hungry|food|lunch|dinner|breakfast|menu|order)\b/i,
    responses: ['Something light, please.', 'I am not hungry right now.', 'Could I see the menu?'],
  },
  {
    id: 'wellbeing',
    pattern: /\b(how are you|how('re| are) you doing|how do you feel|feeling)\b/i,
    responses: ['I am doing all right, thank you.', 'Not so good today.', 'Better than yesterday.'],
  },
  {
    id: 'help-offer',
    pattern: /\b(need (any )?help|can i help|would you like help|anything i can do)\b/i,
    responses: ['Yes, please help me.', 'No, I am fine, thank you.', 'Could you wait a moment?'],
  },
  {
    id: 'readiness',
    pattern: /\b(are you ready|shall we|ready to go|should we start|can we begin)\b/i,
    responses: ['Yes, I am ready.', 'Give me a minute, please.', 'Not just yet.'],
  },
  {
    id: 'greeting',
    pattern: /^\s*(hi|hey|hello|good (morning|afternoon|evening))\b/i,
    responses: ['Hello, good to see you.', 'Hi there.', 'Good to see you too.'],
  },
  {
    id: 'farewell',
    pattern: /\b(goodbye|bye|see you|take care|talk later)\b/i,
    responses: ['Goodbye.', 'See you soon.', 'Take care.'],
  },
  {
    id: 'understanding-check',
    pattern: /\b(do you understand|does that make sense|did you catch that|is that clear)\b/i,
    responses: ['Yes, I understand.', 'No, could you explain again?', 'Please slow down a little.'],
  },
  {
    id: 'yes-no-question',
    pattern: /^\s*(do|does|did|are|is|was|were|can|could|will|would|have|has|had|should|may)\b/i,
    responses: ['Yes, please.', 'No, thank you.', 'I am not sure yet.'],
  },
  {
    id: 'open-question',
    pattern: /^\s*(what|where|when|who|why|how|which)\b/i,
    responses: ['Let me think for a moment.', 'Could you repeat that, please?', 'I will answer in a moment.'],
  },
];

const IDLE_RESPONSES: readonly [string, string, string] = ['Yes.', 'No, thank you.', 'Please wait a moment.'];

/** Continuations offered while the user is part-way through composing. */
const COMPOSITION_CONTINUATIONS: readonly { pattern: RegExp; completions: readonly string[] }[] = [
  { pattern: /\bi need\s*$/i, completions: ['help, please.', 'to rest.', 'some water.'] },
  { pattern: /\bi (would like|want)\s*$/i, completions: ['some water, please.', 'to sit down.', 'to go outside.'] },
  { pattern: /\bcould you\s*$/i, completions: ['help me, please?', 'repeat that, please?', 'slow down a little?'] },
  { pattern: /\bi am\s*$/i, completions: ['tired.', 'in pain.', 'doing all right.'] },
  { pattern: /\bplease\s*$/i, completions: ['wait a moment.', 'help me.', 'call my nurse.'] },
  { pattern: /\bthank\s*$/i, completions: ['you very much.', 'you.', 'you, that helps.'] },
];

// --- Expansion vocabulary ---------------------------------------------------

const POLITE_TOKENS = new Set(['please', 'pls', 'plz']);
const NEGATION_TOKENS = new Set(['no', 'not', 'dont', "don't", 'never']);
const AFFIRM_TOKENS = new Set(['yes', 'yeah', 'yep', 'ok', 'okay']);

const FEELING_ADJECTIVES = new Set([
  'tired', 'cold', 'hot', 'hungry', 'thirsty', 'sad', 'happy', 'scared',
  'dizzy', 'sick', 'sore', 'uncomfortable', 'lonely', 'bored', 'worried', 'fine',
]);

const DESCRIPTIVE_ADJECTIVES = new Set([
  'cold', 'hot', 'warm', 'cool', 'big', 'small', 'little', 'more', 'less',
  'fresh', 'quick', 'slow', 'soft', 'hard', 'light', 'heavy', 'clean', 'new', 'another',
]);

/** Nouns that take "some" rather than "a". */
const MASS_NOUNS = new Set([
  'water', 'juice', 'tea', 'coffee', 'milk', 'food', 'soup', 'bread', 'ice', 'medicine',
]);

/**
 * Abstract nouns that take no determiner at all.
 *
 * "I need some help" is not what anyone says, and an AAC device that puts
 * slightly-wrong English in someone's mouth invites listeners to treat them as
 * less competent than they are. Worth the extra set.
 */
const BARE_NOUNS = new Set(['help', 'air', 'music', 'rest', 'time', 'space', 'quiet', 'privacy']);

const PLACES = new Set([
  'bathroom', 'toilet', 'bed', 'chair', 'outside', 'inside', 'kitchen',
  'window', 'door', 'garden', 'home', 'hospital', 'car',
]);

const PEOPLE = new Set(['nurse', 'doctor', 'mum', 'mom', 'dad', 'family', 'friend', 'carer', 'teacher']);

const ACTION_VERBS = new Set(['need', 'want', 'go', 'help', 'stop', 'call', 'wait', 'come', 'turn', 'open', 'close']);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function determiner(noun: string): string {
  if (BARE_NOUNS.has(noun)) return '';
  if (MASS_NOUNS.has(noun)) return 'some';
  return /^[aeiou]/.test(noun) ? 'an' : 'a';
}

/** Join a determiner to a phrase without leaving a double space behind. */
function withDeterminer(head: string, phrase: string): string {
  const article = determiner(head);
  return article.length > 0 ? `${article} ${phrase}` : phrase;
}

function finish(sentence: string): string {
  const trimmed = sentence.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return '';
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

function buildNounPhrase(tokens: string[]): { phrase: string; head: string } | null {
  const adjectives = tokens.filter((token) => DESCRIPTIVE_ADJECTIVES.has(token));
  const nouns = tokens.filter((token) => !DESCRIPTIVE_ADJECTIVES.has(token));
  if (nouns.length === 0) return null;

  // The head noun decides the determiner; earlier nouns modify it, so
  // "apple juice" reads as juice, not as an apple.
  const head = nouns[nouns.length - 1] as string;
  return { phrase: [...adjectives, ...nouns].join(' '), head };
}

/**
 * Turn minimal keyword input into a complete, polite sentence.
 *
 * The specification's worked examples are the acceptance criteria:
 *   "water cold please" → "I would like some cold water, please."
 *   "apple juice"       → "I would like some apple juice, please."
 */
export function expandShorthand(shorthand: string): string {
  const raw = shorthand.trim();
  if (raw.length === 0) return '';

  const isQuestion = raw.endsWith('?');
  let tokens = tokenize(raw);
  if (tokens.length === 0) return finish(raw);

  const polite = tokens.some((token) => POLITE_TOKENS.has(token));
  tokens = tokens.filter((token) => !POLITE_TOKENS.has(token));
  if (tokens.length === 0) return 'Please.';

  const negated = tokens.some((token) => NEGATION_TOKENS.has(token));
  const affirmed = tokens.some((token) => AFFIRM_TOKENS.has(token));
  tokens = tokens.filter((token) => !NEGATION_TOKENS.has(token) && !AFFIRM_TOKENS.has(token));

  const politeSuffix = polite ? ', please' : '';

  if (tokens.length === 0) {
    if (negated) return 'No, thank you.';
    if (affirmed) return polite ? 'Yes, please.' : 'Yes.';
    return finish(raw);
  }

  const [first, ...rest] = tokens as [string, ...string[]];

  if (ACTION_VERBS.has(first)) {
    const remainder = buildNounPhrase(rest);

    switch (first) {
      case 'stop':
        return 'Please stop.';
      case 'wait':
        return 'Please wait a moment.';
      case 'call': {
        if (!remainder) return finish(`could you make a call${politeSuffix || ', please'}`);
        const target = PEOPLE.has(remainder.head)
          ? `my ${remainder.phrase}`
          : withDeterminer(remainder.head, remainder.phrase);
        return finish(`could you call ${target}${politeSuffix || ', please'}`);
      }
      case 'go': {
        if (!remainder) return finish(`i would like to go${politeSuffix || ', please'}`);
        const preposition = PLACES.has(remainder.head) ? 'to the' : 'to';
        return finish(`i would like to go ${preposition} ${remainder.phrase}${politeSuffix || ', please'}`);
      }
      case 'help': {
        if (!remainder) return 'Could you help me, please?';
        if (PLACES.has(remainder.head)) {
          return finish(`could you help me get to the ${remainder.phrase}, please`).replace(/\.$/, '?');
        }
        return finish(`could you help me with the ${remainder.phrase}, please`).replace(/\.$/, '?');
      }
      case 'need': {
        if (!remainder) return finish(`i need help${politeSuffix}`);
        return finish(`i need ${withDeterminer(remainder.head, remainder.phrase)}${politeSuffix}`);
      }
      case 'want': {
        if (!remainder) return finish(`i would like something${politeSuffix || ', please'}`);
        return finish(`i would like ${withDeterminer(remainder.head, remainder.phrase)}, please`);
      }
      case 'open':
      case 'close':
      case 'turn':
      case 'come': {
        if (!remainder) return finish(`could you ${first}, please`).replace(/\.$/, '?');
        return finish(`could you ${first} the ${remainder.phrase}, please`).replace(/\.$/, '?');
      }
      default:
        break;
    }
  }

  // "I am <feeling>" - the whole input describes the speaker's own state.
  const feelings = tokens.filter((token) => FEELING_ADJECTIVES.has(token));
  const nonFeelings = tokens.filter((token) => !FEELING_ADJECTIVES.has(token));
  if (feelings.length > 0 && nonFeelings.length === 0) {
    const list =
      feelings.length === 1
        ? (feelings[0] as string)
        : `${feelings.slice(0, -1).join(', ')} and ${feelings[feelings.length - 1]}`;
    return finish(negated ? `i am not ${list}` : `i am ${list}`);
  }

  // Bare noun phrase: the commonest AAC input, and the specification's example.
  const nounPhrase = buildNounPhrase(tokens);
  if (nounPhrase) {
    if (isQuestion) {
      return `Could I have ${withDeterminer(nounPhrase.head, nounPhrase.phrase)}, please?`;
    }
    if (negated) {
      return finish(`i do not want ${withDeterminer(nounPhrase.head, nounPhrase.phrase)}${politeSuffix}`);
    }
    // Politeness is the default: a bare noun from an AAC user is a request, and
    // rendering it curtly changes how a listener treats the speaker.
    return finish(`i would like ${withDeterminer(nounPhrase.head, nounPhrase.phrase)}, please`);
  }

  return finish(raw);
}

export function predictResponses(context: PredictionContext): string[] {
  const composition = context.composition.trim();

  // Mid-composition: continue the sentence rather than answer the partner.
  if (composition.length > 0) {
    for (const rule of COMPOSITION_CONTINUATIONS) {
      if (rule.pattern.test(composition)) {
        return rule.completions.map((completion) => `${composition} ${completion}`.replace(/\s+/g, ' '));
      }
    }
    const alternatives = [expandShorthand(composition), finish(composition), 'Could you give me a moment, please?'];
    return [...new Set(alternatives.filter(Boolean))].slice(0, 3);
  }

  const lastPeerTurn = [...context.turns].reverse().find((turn) => turn.source === 'peer');
  if (!lastPeerTurn) return [...IDLE_RESPONSES];

  for (const intent of RESPONSE_INTENTS) {
    if (intent.pattern.test(lastPeerTurn.text)) return [...intent.responses];
  }
  return [...IDLE_RESPONSES];
}

export const heuristicPredictionSource: PredictionSource = {
  id: 'heuristic',
  label: 'On-device rules',
  async available() {
    return true;
  },
  async predict(context) {
    return predictResponses(context);
  },
  async expand(shorthand) {
    return expandShorthand(shorthand);
  },
};
