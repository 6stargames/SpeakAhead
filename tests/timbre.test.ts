import { describe, expect, it } from 'vitest';
import { cosineSimilarity, frameTimbre, utteranceEmbedding, TIMBRE_DIMS } from '@/speech/timbre';

/**
 * Synthetic voices with controlled vocal-tract shapes: harmonics of a chosen
 * fundamental, shaped by formant peaks. Two "people" differ in their formants;
 * one person's utterances differ only in fundamental - exactly the distinction
 * the fingerprint exists to make.
 */
export type Formant = [number, number];

export function formantVoice(
  f0: number,
  formants: Formant[],
  sampleRate = 16000,
  length = 1024,
): Float32Array {
  const frame = new Float32Array(length);
  for (let h = 1; h * f0 < 7600; h += 1) {
    const f = h * f0;
    let amp = 0.02;
    for (const [ff, bw] of formants) amp += Math.exp(-((f - ff) ** 2) / (2 * bw * bw));
    amp *= 1 / (1 + f / 2000); // natural spectral tilt
    for (let i = 0; i < length; i += 1) {
      frame[i] = (frame[i] as number) + amp * Math.sin((2 * Math.PI * f * i) / sampleRate + h * 1.7);
    }
  }
  let peak = 0;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(frame[i] as number));
  if (peak > 0) for (let i = 0; i < length; i += 1) frame[i] = ((frame[i] as number) / peak) * 0.8;
  return frame;
}

export const VOICE_A: Formant[] = [
  [550, 90],
  [1500, 130],
  [2500, 180],
];
export const VOICE_B: Formant[] = [
  [320, 80],
  [2200, 160],
  [3300, 220],
];

/**
 * A voice heard through a strongly colouring channel - loudspeakers, a room,
 * a phone mic. The channel is identical for every voice, which is exactly
 * what made raw fingerprints of different videos score 0.9+ in the field:
 * the shared colouring dwarfs the per-voice differences.
 */
export function colouredVoice(
  f0: number,
  voice: Formant[],
  sampleRate = 16000,
  length = 1024,
): Float32Array {
  const channel: Formant[] = [
    [350, 250],
    [1200, 500],
    [3200, 900],
  ];
  const frame = new Float32Array(length);
  for (let h = 1; h * f0 < 7600; h += 1) {
    const f = h * f0;
    let ch = 0.15;
    for (const [ff, bw] of channel) ch += Math.exp(-((f - ff) ** 2) / (2 * bw * bw));
    let vo = 0.35;
    for (const [ff, bw] of voice) vo += 0.5 * Math.exp(-((f - ff) ** 2) / (2 * bw * bw));
    const amp = (ch * vo) / (1 + f / 2500);
    for (let i = 0; i < length; i += 1) {
      frame[i] = (frame[i] as number) + amp * Math.sin((2 * Math.PI * f * i) / sampleRate + h * 1.7);
    }
  }
  let peak = 0;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(frame[i] as number));
  if (peak > 0) for (let i = 0; i < length; i += 1) frame[i] = ((frame[i] as number) / peak) * 0.8;
  return frame;
}

/** Two voices as heard through that one shared channel. */
export const COLOURED_A: Formant[] = [
  [650, 110],
  [1700, 160],
];
export const COLOURED_B: Formant[] = [
  [450, 100],
  [2300, 200],
];

export function embed(f0s: number[], formants: Formant[]): Float32Array {
  const timbres = f0s
    .map((f0) => frameTimbre(formantVoice(f0, formants), 16000))
    .filter((t): t is Float32Array => t !== null);
  const embedding = utteranceEmbedding(timbres);
  if (!embedding) throw new Error('embedding was null for a voiced signal');
  return embedding;
}

describe('frameTimbre', () => {
  it('produces a fixed-size fingerprint for a voiced frame', () => {
    const timbre = frameTimbre(formantVoice(120, VOICE_A), 16000);
    expect(timbre).not.toBeNull();
    expect(timbre).toHaveLength(TIMBRE_DIMS);
  });

  it('returns null for silence - there is no timbre in nothing', () => {
    expect(frameTimbre(new Float32Array(1024), 16000)).toBeNull();
  });

  it('is loudness-blind: the same voice quieter is the same fingerprint', () => {
    const loud = formantVoice(140, VOICE_A);
    const quiet = Float32Array.from(loud, (s) => s * 0.05);
    const a = frameTimbre(loud, 16000) as Float32Array;
    const b = frameTimbre(quiet, 16000) as Float32Array;
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.99);
  });
});

describe('utteranceEmbedding', () => {
  const A_LOW = embed([105, 110, 115, 120, 125], VOICE_A);
  const A_HIGH = embed([200, 210, 220, 230, 240], VOICE_A);
  const B_LOW = embed([105, 110, 115, 120, 125], VOICE_B);

  it('keeps one voice together across an octave of pitch', () => {
    // The case pitch-only matching could never solve: same vocal tract, the
    // fundamental doubled. The fingerprint barely moves.
    expect(cosineSimilarity(A_LOW, A_HIGH)).toBeGreaterThan(0.95);
  });

  it('separates two voices speaking at exactly the same pitch', () => {
    // And the converse it could never solve either: different vocal tracts,
    // identical fundamental.
    expect(cosineSimilarity(A_LOW, B_LOW)).toBeLessThan(0.6);
  });

  it('same-voice similarity clears the confident threshold with room to spare', () => {
    // The tracker's SIM_CONFIDENT is 0.9 and SIM_POSSIBLE is 0.8; the margin
    // between same-voice and different-voice must dwarf both.
    expect(cosineSimilarity(A_LOW, A_HIGH)).toBeGreaterThan(0.9);
    expect(cosineSimilarity(A_LOW, B_LOW)).toBeLessThan(0.8);
  });

  it('returns null for an empty utterance', () => {
    expect(utteranceEmbedding([])).toBeNull();
  });
});
