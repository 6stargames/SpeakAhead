import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), path), 'utf8');
}

describe('page-independent transcription bridge', () => {
  it('sends a dedicated audio copy from the worklet to the recogniser port', async () => {
    const worklet = await source('public/worklets/aac-capture-worklet.js');
    expect(worklet).toContain("data?.type === 'bind-recognizer-port'");
    expect(worklet).toContain('this.recognizerPort.postMessage');
    expect(worklet).toContain('[recognizerFrame.buffer]');
  });

  it('gates and decodes direct frames inside the recognition worker', async () => {
    const worker = await source('public/workers/sherpa-asr-worker.js');
    expect(worker).toContain("case 'bind-audio-port'");
    expect(worker).toContain('handleDirectFrame(channel, message.samples');
    expect(worker).toContain("return 'speech-start'");
    expect(worker).toContain("return 'speech-end'");
    expect(worker).toContain('if (state.speaking)');
    expect(worker).toContain('state.vad.closeUtterance();');
    expect(worker).toContain('utteranceSequence');
    expect(worker).toContain('utteranceId');
    expect(worker).toContain('closeUtterance(state);');
  });

  it('closes the page fallback gate when the decoder finalises first', async () => {
    const provider = await source('src/speech/asr/SherpaOnnxAsrProvider.ts');
    expect(provider).toContain('if (message.final)');
    expect(provider).toContain('channel.vad.closeUtterance();');
    expect(provider).toContain('channel.speaking = false;');
    expect(provider).toContain('utteranceId: message.utteranceId');
    expect(provider).toContain('coep=v2&utterances=v1');
  });

  it('keeps the established page path as a fallback until the direct bridge acknowledges', async () => {
    const session = await source('src/session/AacSession.ts');
    const graph = await source('src/audio/AudioGraph.ts');
    expect(session).toContain('if (!this.graph.directRecognizerAttached(frame.channel))');
    expect(graph).toContain("data.type === 'direct-recognizer-ready'");
  });
});
