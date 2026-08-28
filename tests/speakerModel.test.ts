import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kaldiFbank, FBANK_BINS } from '@/speech/fbank';
import { cosineSimilarity } from '@/speech/timbre';

/**
 * End-to-end check of the neural speaker path: JS fbank front end feeding the
 * real CAM++ ONNX network. Skipped when the model has not been fetched (it is
 * never committed); run `npm run fetch:models` first. What it proves is that
 * the front end speaks the dialect the network was trained on — if the
 * features were on the wrong scale, these margins would collapse.
 */
const MODEL_PATH = resolve(__dirname, '..', 'public', 'models', 'speaker-v1', 'campplus-en-voxceleb.onnx');
const hasModel = existsSync(MODEL_PATH);

/** A speech-like synthetic voice: formant envelope + wandering pitch. */
function speechLike(
  seconds: number,
  baseF0: number,
  formants: [number, number][],
  seed: number,
  sampleRate = 16000,
): Float32Array {
  const length = Math.floor(seconds * sampleRate);
  const out = new Float32Array(length);
  let phase = 0;
  let rng = seed;
  const rand = (): number => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  // Piecewise segments imitate syllables: pitch and loudness move every 120ms.
  const segment = Math.floor(0.12 * sampleRate);
  let f0 = baseF0;
  let level = 0.6;
  for (let i = 0; i < length; i += 1) {
    if (i % segment === 0) {
      f0 = baseF0 * (0.85 + 0.5 * rand());
      level = 0.35 + 0.5 * rand();
    }
    phase += (2 * Math.PI * f0) / sampleRate;
    let sample = 0;
    for (let h = 1; h <= 24; h += 1) {
      const f = h * f0;
      if (f > 7600) break;
      let amp = 0.03;
      for (const [ff, bw] of formants) amp += Math.exp(-((f - ff) ** 2) / (2 * bw * bw));
      amp /= 1 + f / 2000;
      sample += amp * Math.sin(phase * h + h * 1.3);
    }
    out[i] = sample * level * 0.15;
  }
  return out;
}

const FORMANTS_A: [number, number][] = [
  [560, 90],
  [1480, 140],
  [2500, 180],
];
const FORMANTS_B: [number, number][] = [
  [330, 80],
  [2100, 170],
  [3200, 230],
];

describe.skipIf(!hasModel)('CAM++ speaker embeddings (requires fetched model)', () => {
  it(
    'separates voices and survives pitch changes through the real network',
    { timeout: 120_000 },
    async () => {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(new Uint8Array(readFileSync(MODEL_PATH)), {
        executionProviders: ['wasm'],
      });

      const embed = async (samples: Float32Array): Promise<Float32Array> => {
        const fbank = kaldiFbank(samples);
        if (!fbank) throw new Error('clip too short');
        const inputName = session.inputNames[0] as string;
        const tensor = new ort.Tensor('float32', fbank.features, [1, fbank.frames, FBANK_BINS]);
        const outputs = await session.run({ [inputName]: tensor });
        const output = outputs[session.outputNames[0] as string];
        if (!output) throw new Error('no output');
        return Float32Array.from(output.data as Float32Array);
      };

      const aLow = await embed(speechLike(2.5, 115, FORMANTS_A, 7));
      const aAgain = await embed(speechLike(2.5, 125, FORMANTS_A, 1234));
      const b = await embed(speechLike(2.5, 115, FORMANTS_B, 55));

      const sameContent = cosineSimilarity(aLow, aAgain);
      const cross = cosineSimilarity(aLow, b);

      // Diagnostic output: these numbers are what the tracker thresholds rest
      // on. (No octave case here: a sine-harmonic stack at doubled f0 shares
      // none of the cues a real voice keeps when pitch rises, so it is
      // out-of-distribution for a network trained on people.)
      console.log(
        `same voice, different content: ${sameContent.toFixed(3)} · different voice, same pitch: ${cross.toFixed(3)}`,
      );

      // If the fbank front end were on the wrong scale, this margin collapses.
      expect(sameContent).toBeGreaterThan(0.7);
      expect(sameContent).toBeGreaterThan(cross + 0.15);
    },
  );
});
