/**
 * Kaldi-compatible 80-bin log-mel filterbank features.
 *
 * The speaker-verification network was trained on Kaldi fbank features, so
 * this reproduces that front end exactly: 25ms Povey-windowed frames every
 * 10ms, DC removal, 0.97 pre-emphasis, a 512-point power spectrum, 80
 * triangular mel filters from 20 Hz to Nyquist on Kaldi's 1127·ln(1+f/700)
 * scale, natural-log energies, and per-utterance mean subtraction (CMN) the
 * way the 3D-Speaker inference pipeline applies it. Matching the training
 * front end is not optional — a model fed features on a different scale
 * produces confident nonsense.
 */

export const FBANK_BINS = 80;

const FRAME_LENGTH = 400; // 25 ms at 16 kHz
const FRAME_SHIFT = 160; // 10 ms
const FFT_SIZE = 512;
const FFT_BINS = FFT_SIZE / 2 + 1;
const PREEMPHASIS = 0.97;
const LOW_FREQ = 20;

const kaldiMel = (hz: number): number => 1127 * Math.log(1 + hz / 700);
const kaldiMelToHz = (mel: number): number => 700 * (Math.exp(mel / 1127) - 1);

/** Povey window: Hann raised to 0.85, Kaldi's default. */
const WINDOW = new Float32Array(FRAME_LENGTH);
for (let i = 0; i < FRAME_LENGTH; i += 1) {
  WINDOW[i] = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_LENGTH - 1))) ** 0.85;
}

const REVERSED = new Uint32Array(FFT_SIZE);
{
  const bits = Math.log2(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i += 1) {
    let r = 0;
    for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
    REVERSED[i] = r;
  }
}

function fftInPlace(re: Float32Array, im: Float32Array): void {
  for (let i = 0; i < FFT_SIZE; i += 1) {
    const j = REVERSED[i] as number;
    if (j > i) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= FFT_SIZE; size *= 2) {
    const half = size / 2;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let k = 0; k < half; k += 1) {
        const angle = step * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const even = start + k;
        const odd = even + half;
        const or_ = re[odd] as number;
        const oi = im[odd] as number;
        const tr = or_ * wr - oi * wi;
        const ti = or_ * wi + oi * wr;
        re[odd] = (re[even] as number) - tr;
        im[odd] = (im[even] as number) - ti;
        re[even] = (re[even] as number) + tr;
        im[even] = (im[even] as number) + ti;
      }
    }
  }
}

interface MelBank {
  readonly starts: Int32Array;
  readonly weights: Float32Array[];
}

const bankCache = new Map<number, MelBank>();

function melBank(sampleRate: number): MelBank {
  const cached = bankCache.get(sampleRate);
  if (cached) return cached;

  const nyquist = sampleRate / 2;
  const lowMel = kaldiMel(LOW_FREQ);
  const highMel = kaldiMel(nyquist);
  const delta = (highMel - lowMel) / (FBANK_BINS + 1);
  const binHz = sampleRate / FFT_SIZE;

  const starts = new Int32Array(FBANK_BINS);
  const weights: Float32Array[] = [];
  for (let band = 0; band < FBANK_BINS; band += 1) {
    const leftMel = lowMel + band * delta;
    const centreMel = leftMel + delta;
    const rightMel = centreMel + delta;
    const first = Math.max(0, Math.ceil(kaldiMelToHz(leftMel) / binHz));
    const last = Math.min(FFT_BINS - 1, Math.floor(kaldiMelToHz(rightMel) / binHz));
    starts[band] = first;
    const w = new Float32Array(Math.max(0, last - first + 1));
    for (let bin = first; bin <= last; bin += 1) {
      const mel = kaldiMel(bin * binHz);
      const t = mel <= centreMel ? (mel - leftMel) / delta : (rightMel - mel) / delta;
      w[bin - first] = Math.max(0, t);
    }
    weights.push(w);
  }
  const bank: MelBank = { starts, weights };
  bankCache.set(sampleRate, bank);
  return bank;
}

export interface FbankResult {
  /** Frame count. */
  readonly frames: number;
  /** Row-major [frames × FBANK_BINS], mean-normalised over time. */
  readonly features: Float32Array;
}

/**
 * Compute mean-normalised fbank features for a mono 16 kHz clip.
 *
 * Returns null when the clip is too short to produce a single frame.
 */
export function kaldiFbank(samples: Float32Array, sampleRate = 16000): FbankResult | null {
  if (samples.length < FRAME_LENGTH) return null;
  const frames = 1 + Math.floor((samples.length - FRAME_LENGTH) / FRAME_SHIFT);
  const bank = melBank(sampleRate);
  const features = new Float32Array(frames * FBANK_BINS);

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const windowed = new Float32Array(FRAME_LENGTH);

  for (let f = 0; f < frames; f += 1) {
    const offset = f * FRAME_SHIFT;

    // DC removal over the raw frame, as Kaldi does before pre-emphasis.
    let mean = 0;
    for (let i = 0; i < FRAME_LENGTH; i += 1) mean += samples[offset + i] as number;
    mean /= FRAME_LENGTH;

    for (let i = 0; i < FRAME_LENGTH; i += 1) {
      const current = (samples[offset + i] as number) - mean;
      const previous = i === 0 ? current : (samples[offset + i - 1] as number) - mean;
      windowed[i] = (current - PREEMPHASIS * previous) * (WINDOW[i] as number);
    }

    re.set(windowed);
    re.fill(0, FRAME_LENGTH);
    im.fill(0);
    fftInPlace(re, im);

    for (let band = 0; band < FBANK_BINS; band += 1) {
      const start = bank.starts[band] as number;
      const w = bank.weights[band] as Float32Array;
      let sum = 0;
      for (let k = 0; k < w.length; k += 1) {
        const bin = start + k;
        const r = re[bin] as number;
        const iIm = im[bin] as number;
        sum += (w[k] as number) * (r * r + iIm * iIm);
      }
      features[f * FBANK_BINS + band] = Math.log(Math.max(sum, 1e-10));
    }
  }

  // Per-utterance cepstral mean normalisation, as the 3D-Speaker pipeline
  // applies before the network.
  for (let band = 0; band < FBANK_BINS; band += 1) {
    let mean = 0;
    for (let f = 0; f < frames; f += 1) mean += features[f * FBANK_BINS + band] as number;
    mean /= frames;
    for (let f = 0; f < frames; f += 1) {
      features[f * FBANK_BINS + band] = (features[f * FBANK_BINS + band] as number) - mean;
    }
  }

  return { frames, features };
}
