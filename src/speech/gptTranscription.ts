export interface AccurateTranscriptionResult {
  readonly text: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
}

function joinFrames(frames: readonly Float32Array[]): Float32Array {
  const length = frames.reduce((total, frame) => total + frame.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) {
    samples.set(frame, offset);
    offset += frame.length;
  }
  return samples;
}

/** Encode one completed, mono utterance as 16-bit PCM WAV for transcription. */
export function encodeMonoWav(frames: readonly Float32Array[], sampleRate: number): Blob {
  const samples = joinFrames(frames);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function parseResult(value: unknown): AccurateTranscriptionResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.text !== 'string') return null;
  const text = record.text.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) return null;

  const usageRecord = record.usage && typeof record.usage === 'object'
    ? record.usage as Record<string, unknown>
    : null;
  const token = (key: string) => usageRecord && Number.isFinite(usageRecord[key])
    ? Math.max(0, Math.floor(Number(usageRecord[key])))
    : 0;
  const usage = usageRecord
    ? {
      inputTokens: token('inputTokens'),
      outputTokens: token('outputTokens'),
      totalTokens: token('totalTokens'),
    }
    : undefined;
  return { text, ...(usage ? { usage } : {}) };
}

/**
 * Upgrade one finished ONNX utterance through the authenticated, same-origin
 * transcription route. The microphone is never streamed: only this bounded
 * WAV is sent, after the local recogniser has already committed visible text.
 */
export async function requestAccurateTranscription(
  frames: readonly Float32Array[],
  sampleRate: number,
  recentContext: string,
  signal?: AbortSignal,
): Promise<AccurateTranscriptionResult | null> {
  if (frames.length === 0 || !Number.isFinite(sampleRate) || sampleRate < 8_000) return null;
  const form = new FormData();
  form.set('audio', encodeMonoWav(frames, sampleRate), 'utterance.wav');
  const context = recentContext.replace(/\s+/g, ' ').trim().slice(0, 800);
  if (context) form.set('context', context);

  try {
    const response = await fetch('/api/assist/transcription', {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal,
    });
    if (!response.ok) return null;
    return parseResult(await response.json());
  } catch {
    return null;
  }
}
