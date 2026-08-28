/**
 * Anti-aliased sample-rate conversion for speech capture.
 *
 * Shared verbatim between the AudioWorklet (which imports it as a module script)
 * and the unit tests. Plain ES module, zero dependencies, no DOM access.
 *
 * Downsampling without a low-pass folds everything above the new Nyquist back
 * into the speech band, which shows up as a rise in word error rate that is very
 * hard to attribute later. So we design a windowed-sinc FIR at the target
 * Nyquist, filter, then interpolate.
 */

/**
 * @param {number} cutoffNormalised Cutoff as a fraction of the input sample rate (0 < c < 0.5).
 * @param {number} taps Odd filter length.
 * @returns {Float32Array}
 */
export function designLowPass(cutoffNormalised, taps = 33) {
  const length = taps % 2 === 0 ? taps + 1 : taps;
  const kernel = new Float32Array(length);
  const middle = (length - 1) / 2;
  const omega = 2 * Math.PI * cutoffNormalised;
  let sum = 0;

  for (let i = 0; i < length; i += 1) {
    const n = i - middle;
    // sinc(2*fc*n), with the removable singularity at n === 0 handled explicitly.
    const sinc = n === 0 ? 2 * cutoffNormalised : Math.sin(omega * n) / (Math.PI * n);
    // Hamming window: ~53 dB stopband attenuation, ample for 16 kHz speech.
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (length - 1));
    const value = sinc * window;
    kernel[i] = value;
    sum += value;
  }

  // Normalise to unity DC gain so loudness is preserved across the conversion.
  if (sum !== 0) {
    for (let i = 0; i < length; i += 1) kernel[i] /= sum;
  }
  return kernel;
}

/**
 * Streaming resampler with state carried across calls, so chunk boundaries do
 * not produce discontinuities.
 *
 * @param {number} inputRate
 * @param {number} outputRate
 */
export function createResampler(inputRate, outputRate) {
  const ratio = inputRate / outputRate;
  const passthrough = Math.abs(ratio - 1) < 1e-9;

  // Only filter when decimating; upsampling introduces no aliasing.
  const kernel = passthrough || ratio < 1 ? null : designLowPass(0.45 / ratio, 33);
  const kernelLength = kernel ? kernel.length : 0;
  const history = kernel ? new Float32Array(kernelLength - 1) : null;

  /** Fractional read position carried between chunks. */
  let position = 0;

  return {
    inputRate,
    outputRate,
    ratio,
    passthrough,

    /**
     * @param {Float32Array} input
     * @returns {Float32Array} resampled frames
     */
    process(input) {
      if (input.length === 0) return new Float32Array(0);
      if (passthrough) return input.slice();

      let filtered;
      if (kernel && history) {
        // Convolve over [history, input] so taps spanning the boundary are correct.
        const padded = new Float32Array(history.length + input.length);
        padded.set(history, 0);
        padded.set(input, history.length);

        filtered = new Float32Array(input.length);
        for (let i = 0; i < input.length; i += 1) {
          let accumulator = 0;
          for (let k = 0; k < kernelLength; k += 1) {
            accumulator += kernel[k] * padded[i + k];
          }
          filtered[i] = accumulator;
        }
        history.set(padded.subarray(padded.length - history.length));
      } else {
        filtered = input;
      }

      // Linear interpolation at the fractional read positions.
      const outputLength = Math.max(0, Math.floor((filtered.length - position) / ratio));
      const output = new Float32Array(outputLength);
      for (let i = 0; i < outputLength; i += 1) {
        const source = position + i * ratio;
        const index = Math.floor(source);
        const fraction = source - index;
        const a = filtered[index] ?? 0;
        const b = filtered[index + 1] ?? a;
        output[i] = a + (b - a) * fraction;
      }

      // Carry the remainder so the next chunk continues the same phase.
      position += outputLength * ratio - filtered.length;
      if (position < 0) position = 0;

      return output;
    },

    reset() {
      position = 0;
      history?.fill(0);
    },
  };
}

/**
 * Root-mean-square level of a frame, used as the VAD's energy feature.
 * @param {Float32Array} frame
 * @returns {number}
 */
export function computeRms(frame) {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Peak absolute amplitude — used to detect clipping, which is a common and
 * silent cause of catastrophic recognition failure on cheap headsets.
 * @param {Float32Array} frame
 * @returns {number}
 */
export function computePeak(frame) {
  let peak = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const magnitude = Math.abs(frame[i]);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}
