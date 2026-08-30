import { describe, expect, it } from 'vitest';
import { deriveVitsConfig } from '@/speech/bundleShape';

/**
 * Regression tests for a defect found by running the deployed application.
 *
 * The Piper English bundle packages its model as
 * `/en_US-libritts_r-medium.onnx`, but the helper's default VITS configuration
 * asks for `./model.onnx`. The runtime failed validation with
 * `--vits-model: './model.onnx' does not exist` - and so did the bundle's own
 * demo page, so it was not something the integration could assume away.
 */

const PIPER_FILES = [
  '/.gitignore',
  '/README.md',
  '/en_US-libritts_r-medium.onnx',
  '/tokens.txt',
  '/espeak-ng-data/af_dict',
  '/espeak-ng-data/en_dict',
];

interface VitsShape {
  offlineTtsModelConfig: {
    offlineTtsVitsModelConfig: { model: string; tokens: string; dataDir: string; lexicon: string };
    numThreads: number;
  };
  maxNumSentences: number;
}

describe('deriveVitsConfig', () => {
  it('points at the model the archive actually contains', () => {
    const config = deriveVitsConfig(PIPER_FILES) as unknown as VitsShape;
    const vits = config.offlineTtsModelConfig.offlineTtsVitsModelConfig;

    expect(vits.model).toBe('./en_US-libritts_r-medium.onnx');
    expect(vits.tokens).toBe('./tokens.txt');
    expect(vits.dataDir).toBe('./espeak-ng-data');
  });

  it('defers to the helper when the archive matches its defaults', () => {
    expect(deriveVitsConfig(['/model.onnx', '/tokens.txt'])).toBeUndefined();
  });

  it('defers when the manifest could not be read', () => {
    expect(deriveVitsConfig([])).toBeUndefined();
  });

  it('defers for multi-model architectures rather than guessing', () => {
    // Pocket TTS and ZipVoice package several models; the helper's per-type
    // defaults know how to wire them and a guess would not.
    expect(
      deriveVitsConfig(['/lm_flow.int8.onnx', '/lm_main.int8.onnx', '/encoder.onnx', '/vocab.json']),
    ).toBeUndefined();
  });

  it('defers when no model sits at the archive root', () => {
    expect(deriveVitsConfig(['/espeak-ng-data/en_dict', '/nested/model.onnx'])).toBeUndefined();
  });

  it('omits a lexicon that is not packaged', () => {
    const config = deriveVitsConfig(PIPER_FILES) as unknown as VitsShape;
    expect(config.offlineTtsModelConfig.offlineTtsVitsModelConfig.lexicon).toBe('');
  });

  it('includes a lexicon when one is packaged', () => {
    const config = deriveVitsConfig([...PIPER_FILES, '/lexicon.txt']) as unknown as VitsShape;
    expect(config.offlineTtsModelConfig.offlineTtsVitsModelConfig.lexicon).toBe('./lexicon.txt');
  });

  it('leaves dataDir empty when espeak data is absent', () => {
    const config = deriveVitsConfig(['/voice.onnx', '/tokens.txt']) as unknown as VitsShape;
    expect(config.offlineTtsModelConfig.offlineTtsVitsModelConfig.dataDir).toBe('');
  });

  it('produces a config the helper will accept wholesale', () => {
    // createOfflineTts(Module, myConfig) replaces its defaults entirely, so the
    // top-level shape has to be complete.
    const config = deriveVitsConfig(PIPER_FILES) as unknown as VitsShape;
    expect(config.offlineTtsModelConfig.numThreads).toBe(1);
    expect(config.maxNumSentences).toBe(1);
  });
});
