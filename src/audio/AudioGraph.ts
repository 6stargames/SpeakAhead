import { Emitter } from '@/lib/events';
import {
  assertCompliance,
  evaluateApplicableCompliance,
  RoutingGraph,
  type ComplianceResult,
  type RoutingEdge,
} from './routing';

const CAPTURE_SAMPLE_RATE = 16000;
const CAPTURE_FRAME_SIZE = 1024;
// Keep this root-relative in every bundler. Sites otherwise compiles the
// import.meta base to file:///ROOT and startup stops before requesting the mic.
const WORKLET_URL = '/worklets/aac-capture-worklet.js?coep=v1';

export type CaptureChannel = 'local' | 'remote';

export interface AudioFrame {
  readonly channel: CaptureChannel;
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly rms: number;
  readonly peak: number;
  readonly sequence: number;
}

export interface AudioGraphState {
  readonly running: boolean;
  readonly captureSampleRate: number;
  readonly playbackSampleRate: number;
  readonly resamplingCapture: boolean;
  readonly micAttached: boolean;
  readonly remoteAttached: boolean;
  readonly emergencyOverride: boolean;
  readonly playbackState: AudioContextState | 'uninitialised';
}

interface AudioGraphEvents extends Record<string, unknown> {
  frame: AudioFrame;
  compliance: ComplianceResult[];
  state: AudioGraphState;
  error: Error;
}

/**
 * The RAUR-compliant audio topology.
 *
 * Two AudioContexts, deliberately:
 *
 *   captureContext  (16 kHz) — microphone + remote-for-analysis. Has no path to
 *                              `destination` at all. Nothing captured here can
 *                              be heard or transmitted; it exists only to feed
 *                              the on-device recogniser.
 *   playbackContext (native) — synthesised speech + remote monitoring + the
 *                              MediaStreamAudioDestinationNode handed to WebRTC.
 *
 * Splitting the contexts turns "the microphone must never reach the peer" from a
 * convention that a future refactor could quietly break into something closer to
 * a structural impossibility: the mic's source node belongs to a context that
 * owns no outbound sink.
 */
export class AacAudioGraph {
  readonly events = new Emitter<AudioGraphEvents>();
  readonly routing = new RoutingGraph();

  #captureContext: AudioContext | null = null;
  #playbackContext: AudioContext | null = null;

  #micStream: MediaStream | null = null;
  #micSource: MediaStreamAudioSourceNode | null = null;
  #micSplitter: ChannelSplitterNode | null = null;
  #micCapture: AudioWorkletNode | null = null;

  #remoteStream: MediaStream | null = null;
  #remoteCaptureSource: MediaStreamAudioSourceNode | null = null;
  #remoteCapture: AudioWorkletNode | null = null;
  #remoteMonitorSource: MediaStreamAudioSourceNode | null = null;
  #remoteMonitorGain: GainNode | null = null;
  /**
   * Chrome only pumps a remote WebRTC track into the Web Audio graph while the
   * stream is also bound to a media element. The element stays muted; it exists
   * purely to keep the track flowing.
   */
  #remoteKeepAlive: HTMLAudioElement | null = null;

  #ttsBus: GainNode | null = null;
  #localMonitorGain: GainNode | null = null;
  #peerDestination: MediaStreamAudioDestinationNode | null = null;

  #activeSources = new Set<AudioBufferSourceNode>();
  #emergencyOverride = false;
  #resamplingCapture = false;
  #disposed = false;

  get running(): boolean {
    return this.#playbackContext !== null;
  }

  get peerStream(): MediaStream | null {
    return this.#peerDestination?.stream ?? null;
  }

  /**
   * The single track permitted to reach RTCPeerConnection.addTrack.
   * Contains synthesised speech and nothing else.
   */
  get outboundTrack(): MediaStreamTrack | null {
    return this.#peerDestination?.stream.getAudioTracks()[0] ?? null;
  }

  get playbackContext(): AudioContext | null {
    return this.#playbackContext;
  }

  get emergencyOverride(): boolean {
    return this.#emergencyOverride;
  }

  async start(): Promise<void> {
    if (this.#disposed) throw new Error('AacAudioGraph has been disposed.');
    if (this.#playbackContext) {
      await this.resume();
      return;
    }

    // Requesting 16 kHz lets the browser's own high-quality resampler do the
    // work. Where the platform refuses (Safari historically pins to 44.1/48),
    // the worklet resamples instead — hence the flag.
    let captureContext: AudioContext;
    try {
      captureContext = new AudioContext({
        sampleRate: CAPTURE_SAMPLE_RATE,
        latencyHint: 'interactive',
      });
    } catch {
      captureContext = new AudioContext({ latencyHint: 'interactive' });
    }
    this.#resamplingCapture = Math.abs(captureContext.sampleRate - CAPTURE_SAMPLE_RATE) > 1;

    const playbackContext = new AudioContext({ latencyHint: 'interactive' });

    await captureContext.audioWorklet.addModule(WORKLET_URL);

    this.#captureContext = captureContext;
    this.#playbackContext = playbackContext;

    // ---- Playback topology -------------------------------------------------
    this.#ttsBus = playbackContext.createGain();
    this.#ttsBus.gain.value = 1;

    this.#localMonitorGain = playbackContext.createGain();
    this.#localMonitorGain.gain.value = 1;

    this.#peerDestination = playbackContext.createMediaStreamDestination();

    this.#ttsBus.connect(this.#localMonitorGain);
    this.#localMonitorGain.connect(playbackContext.destination);
    this.#ttsBus.connect(this.#peerDestination);

    this.routing.connect('tts', 'tts-bus');
    this.routing.connect('tts-bus', 'local-monitor');
    this.routing.connect('local-monitor', 'speakers');
    this.routing.connect('tts-bus', 'peer');

    this.#publishCompliance();
    this.#publishState();
  }

  /** Autoplay policy: contexts start suspended until a user gesture. */
  async resume(): Promise<void> {
    await Promise.all([
      this.#captureContext?.state === 'suspended' ? this.#captureContext.resume() : Promise.resolve(),
      this.#playbackContext?.state === 'suspended' ? this.#playbackContext.resume() : Promise.resolve(),
    ]);
    this.#publishState();
  }

  // -------------------------------------------------------------------------
  // Microphone — capture context only.
  // -------------------------------------------------------------------------

  async attachMicrophone(stream: MediaStream): Promise<void> {
    const context = this.#requireCaptureContext();
    this.detachMicrophone();

    this.#micStream = stream;
    this.#micSource = context.createMediaStreamSource(stream);

    // The spec calls for a ChannelSplitterNode. Beyond matching the spec it is
    // genuinely useful: headsets frequently present a stereo device where only
    // one channel carries the boom mic, and summing them halves the SNR.
    this.#micSplitter = context.createChannelSplitter(
      Math.max(1, stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1),
    );
    this.#micCapture = this.#createCaptureNode(context, 'local');

    this.#micSource.connect(this.#micSplitter);
    this.#micSplitter.connect(this.#micCapture, 0, 0);

    this.routing.connect('microphone', 'mic-splitter');
    this.routing.connect('mic-splitter', 'mic-capture');
    this.routing.connect('mic-capture', 'asr');

    // Fail loudly and immediately rather than shipping a quiet violation — but
    // only against the rules that apply right now. A microphone attached before
    // any call must not be judged against rules describing a peer that does not
    // exist yet.
    try {
      assertCompliance(this.routing, {
        callActive: this.#remoteStream !== null,
        micActive: true,
        emergencyOverride: this.#emergencyOverride,
      });
    } catch (error) {
      // Never leave a live microphone behind on a failed attach: the recording
      // indicator would stay lit with nothing in the interface to explain it.
      this.detachMicrophone();
      throw error;
    }
    this.#publishCompliance();
    this.#publishState();
  }

  detachMicrophone(): void {
    this.#micCapture?.port.postMessage({ type: 'stop' });
    this.#micCapture?.disconnect();
    this.#micSplitter?.disconnect();
    this.#micSource?.disconnect();

    for (const track of this.#micStream?.getTracks() ?? []) track.stop();

    this.#micCapture = null;
    this.#micSplitter = null;
    this.#micSource = null;
    this.#micStream = null;

    this.routing.disconnect('microphone');
    this.routing.disconnect('mic-splitter');
    this.routing.disconnect('mic-capture');

    this.#publishCompliance();
    this.#publishState();
  }

  // -------------------------------------------------------------------------
  // Remote peer audio — monitored *and* harvested for context.
  // -------------------------------------------------------------------------

  attachRemoteStream(stream: MediaStream): void {
    const captureContext = this.#requireCaptureContext();
    const playbackContext = this.#requirePlaybackContext();
    this.detachRemoteStream();

    this.#remoteStream = stream;

    this.#remoteKeepAlive = new Audio();
    this.#remoteKeepAlive.srcObject = stream;
    this.#remoteKeepAlive.muted = true;
    this.#remoteKeepAlive.autoplay = true;
    void this.#remoteKeepAlive.play().catch(() => {
      /* Autoplay refusal is harmless: the Web Audio path carries the audio. */
    });

    // Monitoring path.
    this.#remoteMonitorSource = playbackContext.createMediaStreamSource(stream);
    this.#remoteMonitorGain = playbackContext.createGain();
    this.#remoteMonitorGain.gain.value = this.#emergencyOverride ? 0 : 1;
    this.#remoteMonitorSource.connect(this.#remoteMonitorGain);
    if (!this.#emergencyOverride) {
      this.#remoteMonitorGain.connect(playbackContext.destination);
      this.routing.connect('remote-monitor', 'speakers');
    }

    // Contextual harvesting path.
    this.#remoteCaptureSource = captureContext.createMediaStreamSource(stream);
    this.#remoteCapture = this.#createCaptureNode(captureContext, 'remote');
    this.#remoteCaptureSource.connect(this.#remoteCapture);

    this.routing.connect('remote', 'remote-monitor');
    this.routing.connect('remote', 'remote-capture');
    this.routing.connect('remote-capture', 'asr');

    this.#publishCompliance();
    this.#publishState();
  }

  detachRemoteStream(): void {
    this.#remoteCapture?.port.postMessage({ type: 'stop' });
    this.#remoteCapture?.disconnect();
    this.#remoteCaptureSource?.disconnect();
    this.#remoteMonitorGain?.disconnect();
    this.#remoteMonitorSource?.disconnect();

    if (this.#remoteKeepAlive) {
      this.#remoteKeepAlive.pause();
      this.#remoteKeepAlive.srcObject = null;
      this.#remoteKeepAlive = null;
    }

    this.#remoteCapture = null;
    this.#remoteCaptureSource = null;
    this.#remoteMonitorGain = null;
    this.#remoteMonitorSource = null;
    this.#remoteStream = null;

    this.routing.disconnect('remote');
    this.routing.disconnect('remote-capture');
    this.routing.disconnect('remote-monitor');

    this.#publishCompliance();
    this.#publishState();
  }

  // -------------------------------------------------------------------------
  // Synthesised speech.
  // -------------------------------------------------------------------------

  /**
   * Play synthesised PCM through the TTS bus, which fans out to both the local
   * speakers and the peer connection.
   *
   * @returns a promise that settles when playback finishes.
   */
  async playSynthesis(samples: Float32Array, sampleRate: number): Promise<void> {
    const context = this.#requirePlaybackContext();
    const bus = this.#ttsBus;
    if (!bus) throw new Error('Audio graph is not started.');

    if (context.state === 'suspended') await context.resume();
    if (samples.length === 0) return;

    const buffer = context.createBuffer(1, samples.length, sampleRate);
    // `set` rather than `copyToChannel`: the samples arrive from a worker, so
    // their backing store is typed as ArrayBufferLike, and this avoids a cast.
    buffer.getChannelData(0).set(samples);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(bus);
    this.#activeSources.add(source);

    await new Promise<void>((resolve) => {
      source.onended = () => {
        this.#activeSources.delete(source);
        source.disconnect();
        resolve();
      };
      source.start();
    });
  }

  /** Cut synthesis instantly — used by Stop and by the emergency override. */
  stopSynthesis(): void {
    for (const source of [...this.#activeSources]) {
      try {
        source.stop();
      } catch {
        /* Already stopped. */
      }
      source.disconnect();
      this.#activeSources.delete(source);
    }
  }

  // -------------------------------------------------------------------------
  // Gain control and the RAUR Need 11 emergency override.
  // -------------------------------------------------------------------------

  setTtsGain(value: number): void {
    if (this.#ttsBus) this.#ttsBus.gain.value = clampGain(value);
  }

  setLocalMonitorGain(value: number): void {
    if (this.#localMonitorGain) this.#localMonitorGain.gain.value = clampGain(value);
  }

  setRemoteMonitorGain(value: number): void {
    if (this.#emergencyOverride) return;
    if (this.#remoteMonitorGain) this.#remoteMonitorGain.gain.value = clampGain(value);
  }

  /**
   * RAUR Need 11 — the user must be able to communicate in an emergency.
   *
   * Everything inbound is severed from the speakers and the synthetic voice is
   * driven to unity ceiling, so nothing can drown out the person trying to
   * speak. This is a latch, not a momentary control: in an emergency nobody
   * should have to hold a button down.
   */
  setEmergencyOverride(enabled: boolean): void {
    if (this.#emergencyOverride === enabled) return;
    this.#emergencyOverride = enabled;

    const playbackContext = this.#playbackContext;

    if (enabled) {
      this.stopSynthesis();
      if (this.#remoteMonitorGain) {
        this.#remoteMonitorGain.gain.value = 0;
        try {
          this.#remoteMonitorGain.disconnect();
        } catch {
          /* Not connected. */
        }
      }
      this.routing.disconnect('remote-monitor', 'speakers');
      this.setTtsGain(1);
      this.setLocalMonitorGain(1);
    } else {
      if (this.#remoteMonitorGain && playbackContext) {
        this.#remoteMonitorGain.gain.value = 1;
        this.#remoteMonitorGain.connect(playbackContext.destination);
        this.routing.connect('remote-monitor', 'speakers');
      }
    }

    this.#publishCompliance();
    this.#publishState();
  }

  // -------------------------------------------------------------------------
  // Introspection.
  // -------------------------------------------------------------------------

  compliance(): ComplianceResult[] {
    return evaluateApplicableCompliance(this.routing, {
      callActive: this.#peerDestination !== null && this.#remoteStream !== null,
      micActive: this.#micSource !== null,
      emergencyOverride: this.#emergencyOverride,
    });
  }

  edges(): RoutingEdge[] {
    return this.routing.edges();
  }

  state(): AudioGraphState {
    return {
      running: this.running,
      captureSampleRate: this.#captureContext?.sampleRate ?? 0,
      playbackSampleRate: this.#playbackContext?.sampleRate ?? 0,
      resamplingCapture: this.#resamplingCapture,
      micAttached: this.#micSource !== null,
      remoteAttached: this.#remoteStream !== null,
      emergencyOverride: this.#emergencyOverride,
      playbackState: this.#playbackContext?.state ?? 'uninitialised',
    };
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;

    this.stopSynthesis();
    this.detachMicrophone();
    this.detachRemoteStream();

    this.#ttsBus?.disconnect();
    this.#localMonitorGain?.disconnect();
    this.#peerDestination?.disconnect();

    await Promise.allSettled([this.#captureContext?.close(), this.#playbackContext?.close()]);

    this.#captureContext = null;
    this.#playbackContext = null;
    this.#ttsBus = null;
    this.#localMonitorGain = null;
    this.#peerDestination = null;

    this.routing.clear();
    this.events.clear();
  }

  // -------------------------------------------------------------------------

  #createCaptureNode(context: AudioContext, channel: CaptureChannel): AudioWorkletNode {
    const node = new AudioWorkletNode(context, 'aac-capture', {
      numberOfInputs: 1,
      // Zero outputs: the capture path has no route to the speakers or the peer.
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: {
        channel,
        targetSampleRate: CAPTURE_SAMPLE_RATE,
        frameSize: CAPTURE_FRAME_SIZE,
      },
    });

    node.port.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: 'frame'; channel: CaptureChannel; samples: Float32Array; sampleRate: number; rms: number; peak: number; sequence: number }
        | { type: 'ready'; resampling: boolean }
        | { type: string };

      if (data.type === 'frame') {
        const frame = data as Extract<typeof data, { type: 'frame' }>;
        this.events.emit('frame', {
          channel: frame.channel,
          samples: frame.samples,
          sampleRate: frame.sampleRate,
          rms: frame.rms,
          peak: frame.peak,
          sequence: frame.sequence,
        });
      } else if (data.type === 'ready') {
        this.#resamplingCapture = Boolean((data as { resampling?: boolean }).resampling);
        this.#publishState();
      }
    };

    node.onprocessorerror = () => {
      this.events.emit(
        'error',
        new Error(`Capture worklet failed on the "${channel}" channel. Audio capture has stopped.`),
      );
    };

    return node;
  }

  #requireCaptureContext(): AudioContext {
    if (!this.#captureContext) throw new Error('Audio graph is not started. Call start() first.');
    return this.#captureContext;
  }

  #requirePlaybackContext(): AudioContext {
    if (!this.#playbackContext) throw new Error('Audio graph is not started. Call start() first.');
    return this.#playbackContext;
  }

  #publishCompliance(): void {
    this.events.emit('compliance', this.compliance());
  }

  #publishState(): void {
    this.events.emit('state', this.state());
  }
}

function clampGain(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
