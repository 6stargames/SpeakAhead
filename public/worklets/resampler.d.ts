/**
 * Type contract for the resampler shared by the AudioWorklet and the tests.
 * The implementation is plain JavaScript so the worklet can import it directly
 * as a module script, with no build step in the audio path.
 */

export interface StreamingResampler {
  readonly inputRate: number;
  readonly outputRate: number;
  readonly ratio: number;
  /** True when input and output rates match and samples pass through unchanged. */
  readonly passthrough: boolean;
  /** Convert one chunk, carrying filter and phase state across calls. */
  process(input: Float32Array): Float32Array;
  reset(): void;
}

/** Windowed-sinc low-pass kernel, normalised to unity DC gain. */
export function designLowPass(cutoffNormalised: number, taps?: number): Float32Array;

export function createResampler(inputRate: number, outputRate: number): StreamingResampler;

/** Root-mean-square amplitude of a frame — the VAD's energy feature. */
export function computeRms(frame: Float32Array): number;

/** Peak absolute amplitude, used to detect clipping. */
export function computePeak(frame: Float32Array): number;
