import type { WordConfidence } from './confidence';
import type { Emitter } from '@/lib/events';
import type { AudioFrame, CaptureChannel } from '@/audio/AudioGraph';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export interface EngineInfo {
  readonly status: EngineStatus;
  /** `sherpa-onnx` (edge), `web-speech` (platform), or `none`. */
  readonly implementation: 'sherpa-onnx' | 'web-speech' | 'none';
  /** True when inference provably happens on this device. */
  readonly offline: boolean;
  readonly detail?: string;
  readonly modelName?: string;
  readonly heapBytes?: number;
  readonly streaming?: boolean;
}

export interface RecognitionResult {
  readonly channel: CaptureChannel;
  /** Stable sequence number for every result from one acoustic utterance. */
  readonly utteranceId?: number;
  readonly text: string;
  readonly final: boolean;
  readonly refined?: boolean;
  readonly timestamp: number;
  /** Per-word decoder confidence, when the engine reports token evidence. */
  readonly words?: WordConfidence[] | null;
}

export interface AsrEvents extends Record<string, unknown> {
  result: RecognitionResult;
  info: EngineInfo;
  error: Error;
}

export interface AsrProvider {
  readonly events: Emitter<AsrEvents>;
  readonly info: EngineInfo;
  init(): Promise<void>;
  /**
   * Create a dedicated worklet-to-worker input. When present, captured audio
   * can reach the recogniser without crossing the page thread.
   */
  createAudioInputPort?(channel: CaptureChannel): MessagePort | null;
  /** Feed a 16 kHz mono analysis frame. Must be non-blocking. */
  acceptFrame(frame: AudioFrame): void;
  /** Force an endpoint on a channel - the VAD decided speech ended. */
  flush(channel: CaptureChannel): void;
  reset(channel: CaptureChannel): void;
  /** Optional second pass restoring punctuation and casing. */
  refine?(text: string): Promise<string>;
  dispose(): Promise<void>;
}

export interface TtsVoice {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly speakerId?: number;
}

export interface SynthesisRequest {
  readonly text: string;
  readonly voiceId?: string;
  /** 1.0 is the model's natural rate. */
  readonly rate?: number;
}

export interface SynthesisResult {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly durationMs: number;
}

export interface TtsEvents extends Record<string, unknown> {
  info: EngineInfo;
  error: Error;
}

export interface TtsProvider {
  readonly events: Emitter<TtsEvents>;
  readonly info: EngineInfo;
  /**
   * Whether synthesised audio can be injected into the Web Audio graph and
   * therefore transmitted over WebRTC.
   *
   * `speechSynthesis` renders straight to the OS mixer, outside any graph we
   * control, so its output can be heard locally but never sent to a peer. That
   * distinction is load-bearing for an AAC device and is surfaced in the UI.
   */
  readonly routable: boolean;
  init(): Promise<void>;
  voices(): TtsVoice[];
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
  /** Only meaningful for non-routable providers that speak directly. */
  speakDirect?(request: SynthesisRequest): Promise<void>;
  cancel(): void;
  dispose(): Promise<void>;
}
