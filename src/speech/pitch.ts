/**
 * Fundamental frequency estimation, used to tell voices apart.
 *
 * Normalised autocorrelation over a 16 kHz analysis frame. This is a cut-down
 * YIN: the squared-difference function with cumulative mean normalisation,
 * which is markedly more robust to octave errors than raw autocorrelation and
 * still cheap enough to run on every frame of speech.
 *
 * What it is honestly good for: separating voices that differ clearly in pitch.
 * What it is not: a speaker identifier. Two people in the same range will be
 * confused, and one person's pitch moves a great deal across a sentence. Every
 * label built on this is a guess the user must be able to correct.
 */

/** Human speech fundamentals: roughly a low male voice to a high child's. */
const MIN_F0_HZ = 70;
const MAX_F0_HZ = 350;

/**
 * Below this the frame is too aperiodic to trust — unvoiced consonants, noise,
 * silence. Returning null for those is what keeps door slams out of a voice
 * profile.
 *
 * 0.15 is the usual figure for clean close-mic audio and is too strict for a
 * room: a voice several feet away, through noise suppression, clears it on few
 * enough frames that whole utterances yielded no pitch at all and went
 * unidentified. Loosened for the environment this actually runs in — the cost
 * of the odd bad frame is absorbed by taking the median across an utterance.
 */
const VOICED_THRESHOLD = 0.25;

/**
 * @param frame mono samples
 * @param sampleRate
 * @returns the estimated fundamental in Hz, or null when the frame is unvoiced
 */
export function estimatePitch(frame: Float32Array, sampleRate: number): number | null {
  const minLag = Math.floor(sampleRate / MAX_F0_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_F0_HZ), Math.floor(frame.length / 2));
  if (maxLag <= minLag) return null;

  // Squared-difference function.
  const difference = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    const limit = frame.length - lag;
    for (let i = 0; i < limit; i += 1) {
      const delta = (frame[i] as number) - (frame[i + lag] as number);
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  // Cumulative mean normalisation: without it the function is minimised at
  // lag 0 and every period sounds equally good, which is where octave errors
  // come from.
  const normalised = new Float32Array(maxLag + 1);
  normalised[minLag] = 1;
  let runningSum = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    runningSum += difference[lag] as number;
    normalised[lag] = runningSum === 0 ? 1 : ((difference[lag] as number) * (lag - minLag + 1)) / runningSum;
  }

  // First minimum below the threshold, rather than the global minimum: the
  // lowest dip often sits an octave down.
  let best = -1;
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    const value = normalised[lag] as number;
    if (value >= VOICED_THRESHOLD) continue;
    if (value < (normalised[lag + 1] as number)) {
      best = lag;
      break;
    }
  }
  if (best === -1) return null;

  // Parabolic interpolation around the minimum for sub-sample precision, which
  // matters: at 16 kHz one lag step near 200 Hz is already several Hz.
  const previous = normalised[best - 1] as number;
  const current = normalised[best] as number;
  const next = normalised[best + 1] as number;
  const denominator = previous + next - 2 * current;
  const shift = denominator === 0 ? 0 : (0.5 * (previous - next)) / denominator;

  const f0 = sampleRate / (best + shift);
  return f0 >= MIN_F0_HZ && f0 <= MAX_F0_HZ ? f0 : null;
}

/**
 * Pitch distance in cents, so comparisons are perceptual rather than linear.
 *
 * A 30 Hz gap separates two low voices and is nothing between two high ones;
 * in cents both read the same, which is what makes a single threshold workable.
 */
export function centsBetween(a: number, b: number): number {
  return Math.abs(1200 * Math.log2(a / b));
}

/**
 * Zero-crossing rate: how often the waveform changes sign, per sample.
 *
 * A second, nearly free voice feature. It tracks spectral tilt — brightness —
 * which is largely independent of pitch, so two people who happen to share a
 * fundamental can still separate on voice quality. On its own it is a poor
 * discriminator; alongside pitch it is worth having for the handful of
 * instructions it costs.
 */
export function zeroCrossingRate(frame: Float32Array): number {
  if (frame.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < frame.length; i += 1) {
    const previous = frame[i - 1] as number;
    const current = frame[i] as number;
    if ((previous >= 0 && current < 0) || (previous < 0 && current >= 0)) crossings += 1;
  }
  return crossings / (frame.length - 1);
}

/** Interquartile range in cents — how much a pitch track wandered. */
export function pitchSpreadCents(pitches: readonly number[]): number {
  if (pitches.length < 4) return 0;
  const sorted = [...pitches].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.25)] as number;
  const high = sorted[Math.floor(sorted.length * 0.75)] as number;
  return centsBetween(high, low);
}

/** Median, which resists the octave errors that would drag a mean around. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
    : (sorted[middle] as number);
}
