/**
 * Voice timbre fingerprinting, used to tell voices apart by how they sound
 * rather than how high they are.
 *
 * Pitch answers "how high is this voice right now" - which one person varies
 * by an octave across a conversation, and two people can share exactly. What
 * actually distinguishes voices is the shape of the vocal tract: the formant
 * structure and spectral tilt that survive every pitch swing. This module
 * measures that shape the way speech systems have for decades: a mel-spaced
 * log spectrum reduced to cepstral coefficients (MFCCs), summarised over an
 * utterance as a fixed-length embedding compared by cosine similarity.
 *
 * It is deliberately loudness-blind (the energy coefficient is dropped) and
 * pitch-blind (24 mel bands blur individual harmonics), so the same voice
 * whispering high and declaiming low lands in the same neighbourhood, while
 * a different vocal tract at the identical pitch does not.
 *
 * Everything here runs on-device on frames the microphone already produced.
 * Nothing leaves; the embedding is the voiceprint BIPA protects, and it lives
 * and dies in this tab's memory.
 */

/** Analysis window. Frames arrive as 1024 samples; shorter ones are padded. */
const FFT_SIZE = 1024;
const FFT_BINS = FFT_SIZE / 2 + 1;

/** Mel filterbank: enough bands to capture formant structure, few enough to
    blur individual harmonics so pitch does not leak into the fingerprint. */
const MEL_BANDS = 24;
const MEL_LOW_HZ = 100;
const MEL_HIGH_HZ = 7600;

/** Cepstral coefficients kept per frame; c0 (loudness) is dropped. */
export const TIMBRE_DIMS = 12;

/** The utterance embedding: per-coefficient mean and spread. */
export const EMBEDDING_DIMS = TIMBRE_DIMS * 2;

const hzToMel = (hz: number): number => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number): number => 700 * (10 ** (mel / 2595) - 1);

/** Hann window, computed once. */
const HANN = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i += 1) {
  HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
}

/**
 * In-place iterative radix-2 FFT. FFT_SIZE is a fixed power of two, so the
 * classic Cooley–Tukey with a precomputed bit-reversal table is all we need -
 * no dependency, and fast enough to run on every voiced frame many times over.
 */
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

interface Filterbank {
  /** For each mel band, the first FFT bin it touches and its weights. */
  readonly starts: Int32Array;
  readonly weights: Float32Array[];
}

/** Filterbanks depend only on the sample rate; frames all share one. */
const filterbankCache = new Map<number, Filterbank>();

function filterbankFor(sampleRate: number): Filterbank {
  const cached = filterbankCache.get(sampleRate);
  if (cached) return cached;

  const highHz = Math.min(MEL_HIGH_HZ, sampleRate / 2);
  const lowMel = hzToMel(MEL_LOW_HZ);
  const highMel = hzToMel(highHz);
  const centres: number[] = [];
  for (let m = 0; m <= MEL_BANDS + 1; m += 1) {
    const mel = lowMel + ((highMel - lowMel) * m) / (MEL_BANDS + 1);
    centres.push((melToHz(mel) * FFT_SIZE) / sampleRate);
  }

  const starts = new Int32Array(MEL_BANDS);
  const weights: Float32Array[] = [];
  for (let band = 0; band < MEL_BANDS; band += 1) {
    const left = centres[band] as number;
    const centre = centres[band + 1] as number;
    const right = centres[band + 2] as number;
    const first = Math.max(0, Math.ceil(left));
    const last = Math.min(FFT_BINS - 1, Math.floor(right));
    starts[band] = first;
    const w = new Float32Array(Math.max(0, last - first + 1));
    for (let bin = first; bin <= last; bin += 1) {
      const t =
        bin <= centre
          ? (bin - left) / Math.max(1e-6, centre - left)
          : (right - bin) / Math.max(1e-6, right - centre);
      w[bin - first] = Math.max(0, t);
    }
    weights.push(w);
  }

  const bank: Filterbank = { starts, weights };
  filterbankCache.set(sampleRate, bank);
  return bank;
}

// Scratch buffers, reused across calls: this runs on every voiced frame and
// must not churn the garbage collector.
const scratchRe = new Float32Array(FFT_SIZE);
const scratchIm = new Float32Array(FFT_SIZE);
const scratchPower = new Float32Array(FFT_BINS);
const scratchMel = new Float32Array(MEL_BANDS);

/**
 * The timbre of one analysis frame: MFCCs 1..12.
 *
 * Returns null for a frame with effectively no energy - there is no timbre in
 * silence, and a zero vector would drag an utterance's embedding toward
 * nothing in particular.
 */
export function frameTimbre(frame: Float32Array, sampleRate: number): Float32Array | null {
  const n = Math.min(frame.length, FFT_SIZE);
  let energy = 0;
  for (let i = 0; i < n; i += 1) {
    const s = (frame[i] as number) * (HANN[i] as number);
    scratchRe[i] = s;
    energy += s * s;
  }
  scratchRe.fill(0, n);
  scratchIm.fill(0);
  if (energy < 1e-7) return null;

  fftInPlace(scratchRe, scratchIm);
  for (let bin = 0; bin < FFT_BINS; bin += 1) {
    const r = scratchRe[bin] as number;
    const i = scratchIm[bin] as number;
    scratchPower[bin] = r * r + i * i;
  }

  const bank = filterbankFor(sampleRate);
  for (let band = 0; band < MEL_BANDS; band += 1) {
    const start = bank.starts[band] as number;
    const w = bank.weights[band] as Float32Array;
    let sum = 0;
    for (let k = 0; k < w.length; k += 1) {
      sum += (w[k] as number) * (scratchPower[start + k] as number);
    }
    scratchMel[band] = Math.log(sum + 1e-10);
  }

  // DCT-II of the log-mel energies; keep 1..TIMBRE_DIMS, dropping c0 so the
  // fingerprint is blind to loudness.
  const out = new Float32Array(TIMBRE_DIMS);
  for (let k = 1; k <= TIMBRE_DIMS; k += 1) {
    let sum = 0;
    for (let band = 0; band < MEL_BANDS; band += 1) {
      sum += (scratchMel[band] as number) * Math.cos((Math.PI * k * (band + 0.5)) / MEL_BANDS);
    }
    out[k - 1] = sum;
  }
  return out;
}

/**
 * Summarise an utterance's frame timbres as one fixed-length embedding:
 * per-coefficient mean and standard deviation, L2-normalised so cosine
 * similarity compares shape, not scale.
 */
export function utteranceEmbedding(timbres: readonly Float32Array[]): Float32Array | null {
  if (timbres.length === 0) return null;

  const mean = new Float32Array(TIMBRE_DIMS);
  for (const t of timbres) {
    for (let d = 0; d < TIMBRE_DIMS; d += 1) mean[d] = (mean[d] as number) + (t[d] as number);
  }
  for (let d = 0; d < TIMBRE_DIMS; d += 1) mean[d] = (mean[d] as number) / timbres.length;

  const embedding = new Float32Array(EMBEDDING_DIMS);
  embedding.set(mean);
  for (const t of timbres) {
    for (let d = 0; d < TIMBRE_DIMS; d += 1) {
      const diff = (t[d] as number) - (mean[d] as number);
      embedding[TIMBRE_DIMS + d] = (embedding[TIMBRE_DIMS + d] as number) + diff * diff;
    }
  }
  for (let d = 0; d < TIMBRE_DIMS; d += 1) {
    embedding[TIMBRE_DIMS + d] = Math.sqrt((embedding[TIMBRE_DIMS + d] as number) / timbres.length);
  }

  let norm = 0;
  for (let d = 0; d < EMBEDDING_DIMS; d += 1) norm += (embedding[d] as number) ** 2;
  norm = Math.sqrt(norm);
  if (norm < 1e-9) return null;
  for (let d = 0; d < EMBEDDING_DIMS; d += 1) embedding[d] = (embedding[d] as number) / norm;
  return embedding;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += (a[i] as number) * (b[i] as number);
    na += (a[i] as number) ** 2;
    nb += (b[i] as number) ** 2;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom < 1e-12 ? 0 : dot / denom;
}
