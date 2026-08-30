import type { ChatGptVoiceName } from './tts/voiceChoices';

export interface ChatGptSpeechResult {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly source: 'saved' | 'generated' | 'unknown';
}

function ascii(view: DataView, offset: number, length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}

/** Decode the PCM WAV returned by the same-origin ChatGPT speech route. */
export function decodeSpeechWav(buffer: ArrayBuffer): Omit<ChatGptSpeechResult, 'source'> | null {
  if (buffer.byteLength < 44) return null;
  const view = new DataView(buffer);
  if (ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') return null;

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const chunkId = ascii(view, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + chunkLength > view.byteLength) return null;
    if (chunkId === 'fmt ' && chunkLength >= 16) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = body;
      dataLength = chunkLength;
    }
    offset = body + chunkLength + (chunkLength % 2);
  }

  if (dataOffset < 0 || channels < 1 || channels > 2 || sampleRate < 8_000) return null;
  if (!((format === 1 && bitsPerSample === 16) || (format === 3 && bitsPerSample === 32))) return null;
  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * channels));
  if (frames <= 0) return null;
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let mixed = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = dataOffset + (frame * channels + channel) * bytesPerSample;
      mixed += format === 1
        ? view.getInt16(offset, true) / 0x8000
        : view.getFloat32(offset, true);
    }
    samples[frame] = Math.max(-1, Math.min(1, mixed / channels));
  }
  return { samples, sampleRate };
}

export async function requestChatGptSpeech(
  text: string,
  voice: ChatGptVoiceName,
  instructions: string,
  rate: number,
  signal?: AbortSignal,
): Promise<ChatGptSpeechResult | null> {
  try {
    const response = await fetch('/api/assist/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/wav' },
      credentials: 'same-origin',
      body: JSON.stringify({ text, voice, instructions, rate }),
      signal,
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/wav')) return null;
    const decoded = decodeSpeechWav(await response.arrayBuffer());
    if (!decoded) return null;
    const value = response.headers.get('x-aac-speech-source');
    const source = value === 'saved' || value === 'generated' ? value : 'unknown';
    return { ...decoded, source };
  } catch {
    return null;
  }
}
