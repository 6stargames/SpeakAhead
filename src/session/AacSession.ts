import { AacAudioGraph, type AudioFrame } from '@/audio/AudioGraph';
import { config } from '@/lib/env';
import { createId, createRoomCode } from '@/lib/id';
import { detectPlatform } from '@/lib/platform';
import { predictionEngine } from '@/prediction/PredictionEngine';
import { NullAsrProvider } from '@/speech/asr/NullAsrProvider';
import { SherpaOnnxAsrProvider } from '@/speech/asr/SherpaOnnxAsrProvider';
import { estimatePitch, zeroCrossingRate } from '@/speech/pitch';
import type { WordConfidence } from '@/speech/confidence';
import { speakerEmbedder } from '@/speech/embed/SpeakerEmbedder';
import { cosineSimilarity, frameTimbre } from '@/speech/timbre';
import { restorePunctuation } from '@/speech/punctuate';
import { requestAccurateTranscription } from '@/speech/gptTranscription';
import { SpeakerChangeDetector } from '@/speech/speakerChange';
import { SpeakerTracker } from '@/speech/speakers';
import { SherpaOnnxTtsProvider } from '@/speech/tts/SherpaOnnxTtsProvider';
import { isSpeechSynthesisAvailable, SpeechSynthesisTtsProvider } from '@/speech/tts/SpeechSynthesisTtsProvider';
import type { AsrProvider, EngineInfo, TtsProvider } from '@/speech/types';
import { actions, selectContextWindow, store, type Turn } from '@/state/store';
import { isWebMcpAvailable } from '@/webmcp/types';
import { loadIceConfiguration } from '@/webrtc/iceConfig';
import { PeerSession } from '@/webrtc/PeerSession';

/** How long after a partner stops speaking before suggestions are refreshed. */
const PREDICTION_DEBOUNCE_MS = 400;

/**
 * Mid-utterance speaker-change detection by voiceprint.
 *
 * The pitch-based change detector misses the podcast case: host B picking up
 * seamlessly at a similar pitch, whose words then ride on host A's still-open
 * bubble as one run-on turn. While an utterance is open, the head of its
 * audio is compared against the most recent second; when the network says
 * those are different people, the utterance is split exactly as a pitch jump
 * would split it. Windows are in gated audio frames (~64ms each).
 */
const CHANGE_HEAD_FRAMES = 24; // ~1.5s: who started this utterance
const CHANGE_TAIL_FRAMES = 16; // ~1s: who is talking right now
const CHANGE_MIN_FRAMES = 44; // head and tail must not overlap
const CHANGE_CHECK_EVERY = 8; // ~every half second of speech
/**
 * Split when head and tail similarity falls below this. Conservative on
 * purpose in the direction that matters: a false split costs one extra
 * bubble from the same person; a missed split mis-attributes someone's
 * words. Field data: same voice 0.56-0.98, different voice 0.40-0.51.
 */
const CHANGE_SPLIT_BELOW = 0.45;

/** Concatenate gated audio frames into one clip for the network. */
function joinFrames(frames: readonly Float32Array[]): Float32Array {
  let total = 0;
  for (const frame of frames) total += frame.length;
  const joined = new Float32Array(total);
  let offset = 0;
  for (const frame of frames) {
    joined.set(frame, offset);
    offset += frame.length;
  }
  return joined;
}

/** One finished utterance, snapshotted at its boundary for attribution. */
interface CapturedUtterance {
  pitches: number[];
  crossings: number[];
  timbres: Float32Array[];
  audio: Float32Array[];
  sampleRate: number;
  considered: number;
}

interface AccurateTranscriptionJob {
  readonly turnId: string;
  readonly expectedText: string;
  readonly captured: CapturedUtterance;
  readonly taskId: string;
  readonly generation: number;
}

/**
 * The application's single controller.
 *
 * Everything stateful lives here — the audio graph, both speech engines, the
 * peer connection — and React only reads the store and calls methods. Keeping
 * the machinery out of components means a re-render can never restart an audio
 * context or leak a WebAssembly handle, which is the failure mode that makes
 * this class of application flaky in ways that are miserable to debug.
 */
export class AacSession {
  readonly graph = new AacAudioGraph();

  #asr: AsrProvider = new NullAsrProvider();
  #tts: TtsProvider = new SpeechSynthesisTtsProvider();
  #peer: PeerSession | null = null;

  #interimTurns = new Map<'local' | 'remote', string>();
  /**
   * Identifier for the message currently being typed.
   *
   * Real-Time Text is a stream of updates to *one* message, not a stream of
   * messages. Minting a fresh id per keystroke made the partner's transcript
   * grow a new line per burst of typing, each stuck at "still speaking" — the
   * exact opposite of what RAUR Need 13 asks for. The id is held until the
   * message is sent or retracted, so the line resolves in place.
   */
  #composingRttId: string | null = null;

  /** Who is speaking in the room, by voice pitch. */
  readonly speakers = new SpeakerTracker();
  /** Voice features for the utterance currently being spoken. */
  #utterancePitches: number[] = [];
  #utteranceCrossings: number[] = [];
  #utteranceTimbres: Float32Array[] = [];
  /** Gated audio for voiceprint and the optional finished-turn GPT pass. ~60s cap. */
  #utteranceAudio: Float32Array[] = [];
  #utteranceSampleRate = 16000;
  /**
   * Frames loud enough to examine, whether or not a pitch came out.
   *
   * The difference matters: zero examined means the microphone heard nothing
   * above the floor, while many examined and none voiced means the estimator
   * could not cope with the audio. Those need opposite fixes, and without the
   * count they are indistinguishable.
   */
  #utteranceFramesConsidered = 0;

  /** Watches for the voice changing part-way through an utterance. */
  #changeDetector = new SpeakerChangeDetector();
  /**
   * Utterances closed by a speaker change, waiting for the recogniser's final
   * result to catch up.
   *
   * Without this the outgoing turn would be attributed using the incoming
   * speaker's frames, since the recogniser's result arrives after the change
   * has already been detected.
   */
  #pendingUtterances: {
    pitches: number[];
    crossings: number[];
    timbres: Float32Array[];
    audio: Float32Array[];
    considered: number;
  }[] = [];

  /** Provisional speaker while someone is still talking. */
  #liveSpeakerId: string | null = null;
  #framesSinceIdentify = 0;

  /** Voiceprint change detection state for the open utterance. */
  #utteranceGeneration = 0;
  #headEmbedding: Float32Array | null = null;
  #headGeneration = -1;
  #changeCheckBusy = false;
  #framesSinceChangeCheck = 0;

  /**
   * Whether the partner is sending Real-Time Text.
   *
   * When they are, their own words are authoritative and the local
   * transcription of their synthesised speech is redundant — running both put
   * every remote utterance in the transcript twice, once as typed and once as
   * heard. Contextual harvesting still matters for a partner who is *not*
   * running this app, which is the case it was built for.
   */
  #peerSendsRtt = false;
  #predictionTimer: ReturnType<typeof setTimeout> | null = null;
  #started = false;

  /** ONNX remains live; signed-in users may opt into this bounded second pass. */
  #accurateTranscriptionEnabled = false;
  #transcriptionGeneration = 0;
  #transcriptionQueue: AccurateTranscriptionJob[] = [];
  #activeTranscriptions = 0;
  #transcriptionControllers = new Set<AbortController>();
  static readonly #TRANSCRIPTION_CONCURRENCY = 2;
  static readonly #MAX_TRANSCRIPTION_QUEUE = 8;
  static readonly #MIN_TRANSCRIPTION_SAMPLES = 4_000;

  get asr(): AsrProvider {
    return this.#asr;
  }
  get tts(): TtsProvider {
    return this.#tts;
  }
  get peer(): PeerSession | null {
    return this.#peer;
  }

  /** Enable the post-ONNX pass only while a ChatGPT identity is present. */
  setAccurateTranscriptionEnabled(enabled: boolean): void {
    if (this.#accurateTranscriptionEnabled === enabled) return;
    this.#accurateTranscriptionEnabled = enabled;
    actions.setAccurateTranscriptionEnabled(enabled);
    this.#transcriptionGeneration += 1;
    if (enabled) return;

    for (const job of this.#transcriptionQueue) {
      actions.finishAccurateTranscription(job.turnId, job.expectedText);
      actions.finishAssistTask('corrections', 'idle', 0, job.taskId);
    }
    this.#transcriptionQueue = [];
    for (const controller of this.#transcriptionControllers) controller.abort();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;

    actions.loadSettings();
    this.#publishPlatform();

    globalThis.addEventListener('online', this.#onConnectivityChange);
    globalThis.addEventListener('offline', this.#onConnectivityChange);

    this.graph.events.on('frame', this.#onFrame);
    this.graph.events.on('compliance', (compliance) => store.set({ compliance }));
    this.graph.events.on('state', (audio) => store.set({ audio, emergencyOverride: audio.emergencyOverride }));
    this.graph.events.on('error', (error) => actions.notify('error', error.message));

    await this.graph.start();
    await this.refreshMicPermission();
    await predictionEngine.detect();
    this.#armAudioUnlock();

    // The voiceprint network starts downloading at boot, not at mic-attach:
    // a 29 MB fetch begun when someone starts talking means the first minutes
    // of every cold session are attributed by the fallback heuristics — which
    // is exactly when first impressions of accuracy are formed.
    speakerEmbedder.onState((status, detail) => actions.setSpeakerModel(status, detail));
    if (config.speakerModelUrl) speakerEmbedder.start(config.speakerModelUrl);
    else actions.setSpeakerModel('idle', 'Disabled: no model URL configured.');

    // Start listening and load the models at the same time, rather than one
    // after the other. Waiting meant nothing happened for the twenty or thirty
    // seconds a cold model download takes — no permission prompt, no listening
    // indicator, no sign the device was doing anything at all. Frames that
    // arrive before the recogniser is ready are dropped by the provider, so
    // there is nothing to gain by holding the microphone back.
    const listening = this.#maybeAutoListen();
    await this.#initSpeechEngines();
    await listening;
    this.#stopListeningIfRecogniserFailed();

    // Chrome's quiet permission UI suppresses microphone prompts that are not
    // backed by a user gesture on sites with no engagement history — a fresh
    // profile or an incognito window silently "denies" without ever asking.
    // A gesture-initiated request is never suppressed, so the first tap or
    // keypress anywhere retries until the microphone is live.
    window.addEventListener('pointerdown', this.#retryMicOnGesture, true);
    window.addEventListener('keydown', this.#retryMicOnGesture, true);
  }

  #micRetryPending = false;

  #retryMicOnGesture = (): void => {
    const state = store.getState();
    if (state.micActive) {
      window.removeEventListener('pointerdown', this.#retryMicOnGesture, true);
      window.removeEventListener('keydown', this.#retryMicOnGesture, true);
      return;
    }
    if (this.#micRetryPending) return;
    if (state.micPermission === 'denied') return;
    this.#micRetryPending = true;
    void this.startMicrophone().finally(() => {
      this.#micRetryPending = false;
      if (store.getState().micActive) {
        window.removeEventListener('pointerdown', this.#retryMicOnGesture, true);
        window.removeEventListener('keydown', this.#retryMicOnGesture, true);
      }
    });
  };

  /**
   * Start listening without being asked.
   *
   * This is the whole point of the device for some people: pressing things may
   * be hard, and a communication aid that will not listen until you operate it
   * has the problem backwards. On a first visit this raises the browser's
   * permission prompt, which is the behaviour to match.
   *
   * The one case it stays quiet is a permission already refused — retrying then
   * only produces an error the user cannot act on from here. The interface says
   * so beside the Dictate button instead.
   */
  async #maybeAutoListen(): Promise<void> {
    const state = store.getState();
    if (state.micActive) return;
    // A permission already refused is the one case worth skipping: retrying
    // only produces an error nobody can act on from this page. The interface
    // says so beside the Dictate button instead.
    if (state.micPermission === 'denied') return;
    await this.startMicrophone();
  }

  /**
   * Release the microphone if the recogniser never arrived.
   *
   * Listening starts before the models finish so the device responds
   * immediately, which means it can be holding the microphone when recognition
   * turns out to be unavailable. Keeping it open then would light the recording
   * indicator on a device that cannot transcribe a word.
   */
  #stopListeningIfRecogniserFailed(): void {
    const state = store.getState();
    if (!state.micActive) return;
    if (state.asr.status === 'ready' || state.asr.status === 'loading') return;

    this.stopMicrophone();
    actions.notify(
      'warning',
      'Stopped listening: no speech recogniser is available, so nothing could be transcribed.',
    );
  }

  /**
   * Resume audio on the first interaction, if the browser suspended it.
   *
   * Autoplay policy leaves an AudioContext suspended until a page earns enough
   * engagement, and a suspended context renders nothing — the capture worklet
   * would never run and dictation would fail silently, which is the worst way
   * for it to fail. Harmless where the context is already running.
   */
  #armAudioUnlock(): void {
    const unlock = () => {
      void this.graph.resume().then(() => {
        if (!store.getState().micActive) {
          void this.#maybeAutoListen();
        }
      });
    };
    for (const event of ['pointerdown', 'keydown'] as const) {
      globalThis.addEventListener(event, unlock, { once: true, passive: true });
    }
  }

  async dispose(): Promise<void> {
    globalThis.removeEventListener('online', this.#onConnectivityChange);
    globalThis.removeEventListener('offline', this.#onConnectivityChange);
    window.removeEventListener('pointerdown', this.#retryMicOnGesture, true);
    window.removeEventListener('keydown', this.#retryMicOnGesture, true);
    if (this.#predictionTimer) clearTimeout(this.#predictionTimer);
    this.setAccurateTranscriptionEnabled(false);

    this.#peer?.hangUp();
    this.#peer = null;

    await Promise.allSettled([this.#asr.dispose(), this.#tts.dispose(), this.graph.dispose()]);
    this.#started = false;
  }

  // -------------------------------------------------------------------------
  // Speech engines
  // -------------------------------------------------------------------------

  async #initSpeechEngines(): Promise<void> {
    // Sequential, synthesis first. Both models are large, and downloading them
    // at once on a modest connection means neither arrives for a long time.
    // Being able to *speak* is the more urgent of the two on a device someone
    // talks with — dictation is one input method among several, but without a
    // voice there is no output at all.
    await this.#initTts().catch(() => {});
    await this.#initAsr().catch(() => {});
  }

  /**
   * Mirror a provider's status into the store before `init()` is awaited.
   *
   * Otherwise the first load shows "idle" for as long as it takes to pull a
   * hundred megabytes of weights, with nothing to say why — which reads as a
   * broken device rather than a loading one.
   */
  #observe(engine: 'asr' | 'tts', provider: { events: { on: (event: 'info', listener: (info: EngineInfo) => void) => () => void }; info: EngineInfo }): void {
    actions.setEngineInfo(engine, provider.info);
    provider.events.on('info', (info) => actions.setEngineInfo(engine, info));
  }

  async #initAsr(): Promise<void> {
    const settings = store.getState().settings;

    const sherpa = new SherpaOnnxAsrProvider({
      base: config.asrBase,
      mode: 'streaming',
      vad: { activationDb: settings.vadSensitivity },
    });
    this.#observe('asr', sherpa);

    try {
      await sherpa.init();
      this.#useAsr(sherpa);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Expected on a fresh clone: weights are not in version control.
      console.info('[aac] Edge recogniser unavailable —', detail);
    }

    // There is no live cloud-provider fallback: instant recognition either
    // runs on-device or reports unavailable. A separate signed-in, bounded
    // second pass may check a completed utterance after ONNX has committed it.
    const nullProvider = new NullAsrProvider();
    await nullProvider.init();
    this.#useAsr(nullProvider);
  }

  #useAsr(provider: AsrProvider): void {
    this.#asr = provider;
    this.graph.setDirectRecognizerPortFactory(
      provider.createAudioInputPort ? (channel) => provider.createAudioInputPort?.(channel) ?? null : null,
    );
    this.#observe('asr', provider);
    provider.events.on('error', (error) => actions.notify('error', error.message));
    provider.events.on('result', (result) => {
      this.#onRecognition(result.channel, result.text, result.final, result.words ?? null);
    });
  }

  async #initTts(): Promise<void> {
    const sherpa = new SherpaOnnxTtsProvider({ base: config.ttsBase });
    this.#observe('tts', sherpa);

    try {
      await sherpa.init();
      this.#useTts(sherpa);
      return;
    } catch (error) {
      console.info('[aac] Edge synthesis unavailable —', error instanceof Error ? error.message : error);
    }

    if (isSpeechSynthesisAvailable()) {
      const platform = new SpeechSynthesisTtsProvider();
      try {
        await platform.init();
        this.#useTts(platform);
        actions.notify(
          'warning',
          'Using the platform voice. It plays through the speakers but cannot be transmitted on a call — your partner will see your text, not hear it.',
        );
        return;
      } catch {
        /* No synthesis at all. */
      }
    }

    actions.notify('error', 'No speech synthesis is available in this browser.');
  }

  #useTts(provider: TtsProvider): void {
    this.#tts = provider;
    this.#observe('tts', provider);
    provider.events.on('error', (error) => actions.notify('error', error.message));

    const voices = provider.voices();
    const settings = store.getState().settings;
    if (!settings.voiceId && voices[0]) actions.setSettings({ voiceId: voices[0].id });
  }

  // -------------------------------------------------------------------------
  // Microphone
  // -------------------------------------------------------------------------

  /**
   * Read the browser's microphone permission.
   *
   * Worth knowing before anything fails: a denied permission is the commonest
   * reason dictation does nothing, and it is invisible unless asked about —
   * `getUserMedia` simply rejects without a prompt, and a user who has been
   * clicking a button that does nothing has no way to discover why.
   */
  async refreshMicPermission(): Promise<void> {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      store.set({ micPermission: status.state as 'granted' | 'denied' | 'prompt' });
      status.onchange = () => {
        const state = status.state as 'granted' | 'denied' | 'prompt';
        store.set({ micPermission: state });
        // Granting permission in the browser's own UI should be enough; making
        // someone reload to benefit from it is a needless extra step.
        if (state === 'granted' && !store.getState().micActive) {
          void this.startMicrophone();
        }
      };
    } catch {
      // Firefox and Safari have not always supported querying it.
      store.set({ micPermission: 'unknown' });
    }
  }

  async startMicrophone(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      const message = 'This browser cannot access a microphone.';
      store.set({ micError: message });
      actions.notify('error', message);
      return;
    }

    store.set({ micError: null });

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      await this.graph.resume();
      await this.graph.attachMicrophone(stream);
      store.set({ micActive: true, micError: null, micPermission: 'granted' });
      // Start the speaker-verification network downloading the moment the
      // microphone is live. Until it is ready, attribution runs on the
      // pitch-and-timbre heuristics; nothing waits for it.
      if (config.speakerModelUrl) speakerEmbedder.start(config.speakerModelUrl);
    } catch (error) {
      // Release the device on any failure. A stream left running keeps the
      // browser's recording indicator lit while the interface shows the
      // microphone as off, which is exactly the wrong way round for a device
      // whose privacy story is the point.
      for (const track of stream?.getTracks() ?? []) track.stop();

      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      const message = denied
        ? 'This site is blocked from using the microphone.'
        : error instanceof Error
          ? error.message
          : String(error);

      store.set({ micActive: false, micError: message });
      if (denied) void this.refreshMicPermission();
      actions.notify('error', `Microphone unavailable: ${message}`);
    }
  }

  stopMicrophone(): void {
    this.graph.detachMicrophone();
    this.#asr.reset('local');
    this.#changeDetector.reset();
    this.#pendingUtterances = [];
    this.#liveSpeakerId = null;
    actions.setLiveSpeaker(null);
    this.#utterancePitches = [];
    this.#utteranceCrossings = [];
    this.#utteranceTimbres = [];
    this.#utteranceAudio = [];
    this.#utteranceFramesConsidered = 0;
    this.#utteranceGeneration += 1;
    this.#framesSinceChangeCheck = 0;
    actions.setDictationPreview('');
    store.set({ micActive: false });
  }

  #onFrame = (frame: AudioFrame): void => {
    // Once the worklet has acknowledged its direct MessagePort, transcription
    // no longer depends on this page callback. Until then, preserve the proven
    // main-thread path so setup or an unsupported browser cannot drop audio.
    if (!this.graph.directRecognizerAttached(frame.channel)) this.#asr.acceptFrame(frame);

    // The gate has to admit someone across the room, not just the person
    // holding the device. At -40 dBFS it excluded every distant speaker, so no
    // pitch was ever collected for them, so they were never attributed, so
    // their words appeared as the user's own. This is low enough to catch a
    // voice from the far side of a room; the estimator itself rejects anything
    // that is not actually voiced.
    if (frame.channel === 'local' && frame.rms > 0.004) {
      this.#utteranceFramesConsidered += 1;
      // Keep the audio itself for the voiceprint network — every gated frame,
      // voiced or not, because unvoiced consonants are part of a voice too.
      this.#utteranceAudio.push(frame.samples.slice());
      this.#utteranceSampleRate = frame.sampleRate;
      if (this.#utteranceAudio.length > 960) this.#utteranceAudio.shift();

      // Watch for the voice changing mid-utterance — by voiceprint, not just
      // pitch. Async and best-effort; a check in flight never blocks audio.
      this.#framesSinceChangeCheck += 1;
      if (this.#framesSinceChangeCheck >= CHANGE_CHECK_EVERY) {
        this.#framesSinceChangeCheck = 0;
        void this.#maybeSplitByVoiceprint();
      }
      const pitch = estimatePitch(frame.samples, frame.sampleRate);
      if (pitch !== null) {
        this.#utterancePitches.push(pitch);
        this.#utteranceCrossings.push(zeroCrossingRate(frame.samples));
        // The timbre fingerprint for the same frame: what the voice sounds
        // like, not how high it is. This is what attribution now runs on.
        const timbre = frameTimbre(frame.samples, frame.sampleRate);
        if (timbre) this.#utteranceTimbres.push(timbre);
        // One utterance cannot need more than a few seconds of history.
        if (this.#utterancePitches.length > 200) {
          this.#utterancePitches.shift();
          this.#utteranceCrossings.shift();
        }
        if (this.#utteranceTimbres.length > 200) this.#utteranceTimbres.shift();
        if (this.#changeDetector.push(pitch)) this.#splitOnSpeakerChange();

        // Name the speaker while they are still talking rather than only once
        // they stop. Every fourth frame is about four times a second: quick
        // enough to feel immediate, rare enough to cost nothing.
        this.#framesSinceIdentify += 1;
        if (this.#framesSinceIdentify >= 4) {
          this.#framesSinceIdentify = 0;
          this.#updateLiveSpeaker();
        }
      }
    }
  };

  /**
   * Close the current utterance because somebody else started talking.
   *
   * The recogniser ends a turn on silence, and people do not leave any, so two
   * speakers land in one bubble attributed to whichever pitch dominated. This
   * forces the recogniser to finalise what it has, so the words so far are
   * attributed to the person who actually said them.
   */
  /** Who the current utterance sounds like so far. Read-only; profiles unchanged. */
  #updateLiveSpeaker(): void {
    const guess = this.speakers.identify({
      pitches: this.#utterancePitches,
      crossingRates: this.#utteranceCrossings,
      timbres: this.#utteranceTimbres,
    });
    if (guess?.id === this.#liveSpeakerId) return;

    this.#liveSpeakerId = guess?.id ?? null;
    actions.setLiveSpeaker(guess ? { id: guess.id, label: guess.label, isOwner: guess.isOwner } : null);
  }

  /** The voice currently being heard, for the waveform to colour itself by. */
  liveSpeakerId(): string | null {
    return this.#liveSpeakerId;
  }

  #splitOnSpeakerChange(carry = 5): void {
    // The frames that identified the change belong to the newcomer, so they
    // stay with the utterance now beginning rather than the one ending. A
    // voiceprint-detected change passes a larger carry: its evidence window
    // is the last second, and all of it belongs to the new speaker.
    this.#utteranceGeneration += 1;
    const boundary = Math.max(0, this.#utterancePitches.length - carry);

    // Timbres and pitches fill at slightly different rates (a frame can
    // yield a pitch but no usable spectrum, or vice versa), so the timbre
    // buffer splits at its own proportional point.
    const timbreBoundary = Math.max(0, this.#utteranceTimbres.length - carry);
    const audioBoundary = Math.max(0, this.#utteranceAudio.length - carry);
    this.#pendingUtterances.push({
      pitches: this.#utterancePitches.slice(0, boundary),
      crossings: this.#utteranceCrossings.slice(0, boundary),
      timbres: this.#utteranceTimbres.slice(0, timbreBoundary),
      audio: this.#utteranceAudio.slice(0, audioBoundary),
      considered: this.#utteranceFramesConsidered,
    });

    this.#utterancePitches = this.#utterancePitches.slice(boundary);
    this.#utteranceCrossings = this.#utteranceCrossings.slice(boundary);
    this.#utteranceTimbres = this.#utteranceTimbres.slice(timbreBoundary);
    this.#utteranceAudio = this.#utteranceAudio.slice(audioBoundary);
    this.#utteranceFramesConsidered = this.#utterancePitches.length;

    this.#asr.flush('local');
  }

  /**
   * Ask the voiceprint network whether the person talking now is the person
   * who started this utterance, and split the turn if not.
   *
   * The pitch detector catches changes between distinct registers; this
   * catches the podcast case — the next voice picking up seamlessly in the
   * same range, which used to ride on the previous speaker's bubble as one
   * run-on sentence. Asynchronous and generation-guarded: by the time an
   * answer arrives the utterance may have ended or split, and a stale answer
   * must do nothing.
   */
  async #maybeSplitByVoiceprint(): Promise<void> {
    if (this.#changeCheckBusy || !speakerEmbedder.ready) return;
    if (this.#utteranceAudio.length < CHANGE_MIN_FRAMES) return;

    const generation = this.#utteranceGeneration;
    this.#changeCheckBusy = true;
    try {
      if (this.#headGeneration !== generation) {
        const head = joinFrames(this.#utteranceAudio.slice(0, CHANGE_HEAD_FRAMES));
        const headEmbedding = await speakerEmbedder.embed(head, this.#utteranceSampleRate);
        if (this.#utteranceGeneration !== generation || !headEmbedding) return;
        this.#headEmbedding = headEmbedding;
        this.#headGeneration = generation;
      }

      if (this.#utteranceAudio.length < CHANGE_MIN_FRAMES) return;
      const tail = joinFrames(this.#utteranceAudio.slice(-CHANGE_TAIL_FRAMES));
      const tailEmbedding = await speakerEmbedder.embed(tail, this.#utteranceSampleRate);
      if (this.#utteranceGeneration !== generation || !tailEmbedding || !this.#headEmbedding) return;

      const similarity = cosineSimilarity(this.#headEmbedding, tailEmbedding);
      if (similarity < CHANGE_SPLIT_BELOW) {
        // The whole tail window belongs to the newcomer.
        this.#splitOnSpeakerChange(CHANGE_TAIL_FRAMES);
      }
    } finally {
      this.#changeCheckBusy = false;
    }
  }

  /**
   * Snapshot the utterance that just finished and reset the live buffers.
   *
   * Synchronous on purpose: the next utterance starts filling the buffers the
   * moment this one ends, so the capture must happen at the boundary even
   * though the attribution itself is now asynchronous (the voiceprint network
   * takes real milliseconds).
   */
  #captureUtterance(): CapturedUtterance {
    // A queued utterance means this final belongs to a speaker who was cut off
    // by someone else starting; the live buffers already hold the newcomer.
    const queued = this.#pendingUtterances.shift();
    const sampleRate = this.#utteranceSampleRate;
    if (queued) return { ...queued, sampleRate };

    const captured = {
      pitches: this.#utterancePitches,
      crossings: this.#utteranceCrossings,
      timbres: this.#utteranceTimbres,
      audio: this.#utteranceAudio,
      sampleRate,
      considered: this.#utteranceFramesConsidered,
    };
    this.#utterancePitches = [];
    this.#utteranceCrossings = [];
    this.#utteranceTimbres = [];
    this.#utteranceAudio = [];
    this.#utteranceFramesConsidered = 0;
    this.#utteranceGeneration += 1;
    this.#framesSinceChangeCheck = 0;
    // A natural end means silence, so the next voice starts fresh.
    this.#changeDetector.reset();
    this.#liveSpeakerId = null;
    this.#framesSinceIdentify = 0;
    actions.setLiveSpeaker(null);
    return captured;
  }

  /** The voiceprint network needs at least half a second of audio to be worth asking. */
  static readonly #MIN_EMBED_SAMPLES = 8000;

  /**
   * Attribute a captured utterance and label its turn.
   *
   * Asynchronous: when the voiceprint network is ready it is consulted first
   * (tens to a couple of hundred milliseconds), and the turn's speaker label
   * lands a beat after the words do. When it is not — first launch, model
   * still downloading, worker failed — attribution falls straight through to
   * the pitch-and-timbre heuristics, exactly as before.
   */
  async #attributeCaptured(turnId: string, captured: CapturedUtterance): Promise<void> {
    let embedding: Float32Array | null = null;
    const totalSamples = captured.audio.reduce((sum, frame) => sum + frame.length, 0);
    if (totalSamples >= AacSession.#MIN_EMBED_SAMPLES && speakerEmbedder.ready) {
      const joined = new Float32Array(totalSamples);
      let offset = 0;
      for (const frame of captured.audio) {
        joined.set(frame, offset);
        offset += frame.length;
      }
      embedding = await speakerEmbedder.embed(joined, captured.sampleRate);
    }

    const speakerId = this.speakers.observe({
      pitches: captured.pitches,
      crossingRates: captured.crossings,
      timbres: captured.timbres,
      embedding,
    });

    // Publish on failure too: an unidentified voice is exactly the case worth
    // being able to look at.
    const attempts = [...this.speakers.attempts()];
    actions.setSpeakers(this.speakers.profiles(), attempts, this.speakers.pendingCount());
    const latest = attempts[attempts.length - 1];

    // The turn may have been trimmed from the window while we were thinking.
    const turn = store.getState().turns.find((candidate) => candidate.id === turnId);
    if (!turn) return;
    actions.upsertTurn({
      id: turn.id,
      source: turn.source,
      text: turn.text,
      final: turn.final,
      ...(speakerId ? { speakerId } : {}),
      voice: {
        pitchHz: latest?.pitchHz ?? null,
        frames: latest?.voicedFrames ?? 0,
        considered: captured.considered,
        reason: latest?.reason ?? 'no measurement',
      },
    });
  }

  #queueAccurateTranscription(
    turnId: string,
    expectedText: string,
    captured: CapturedUtterance,
  ): void {
    const totalSamples = captured.audio.reduce((total, frame) => total + frame.length, 0);
    if (!this.#accurateTranscriptionEnabled || totalSamples < AacSession.#MIN_TRANSCRIPTION_SAMPLES) {
      actions.finishAccurateTranscription(turnId, expectedText);
      return;
    }

    const taskId = actions.beginAssistTask(
      'corrections',
      `GPT transcription for “${expectedText.replace(/\s+/g, ' ').slice(0, 100)}”`,
    );
    this.#transcriptionQueue.push({
      turnId,
      expectedText,
      captured,
      taskId,
      generation: this.#transcriptionGeneration,
    });
    while (this.#transcriptionQueue.length > AacSession.#MAX_TRANSCRIPTION_QUEUE) {
      const skipped = this.#transcriptionQueue.shift();
      if (!skipped) break;
      actions.finishAccurateTranscription(skipped.turnId, skipped.expectedText);
      actions.finishAssistTask('corrections', 'local', 0, skipped.taskId);
    }
    this.#drainAccurateTranscriptions();
  }

  #drainAccurateTranscriptions(): void {
    while (
      this.#activeTranscriptions < AacSession.#TRANSCRIPTION_CONCURRENCY &&
      this.#transcriptionQueue.length > 0
    ) {
      const job = this.#transcriptionQueue.shift();
      if (!job) return;
      this.#activeTranscriptions += 1;
      void this.#runAccurateTranscription(job).finally(() => {
        this.#activeTranscriptions -= 1;
        this.#drainAccurateTranscriptions();
      });
    }
  }

  async #runAccurateTranscription(job: AccurateTranscriptionJob): Promise<void> {
    const controller = new AbortController();
    this.#transcriptionControllers.add(controller);
    let outcome: 'ready' | 'local' | 'idle' = 'local';
    let resultCount = 0;
    try {
      const context = store.getState().turns
        .filter((turn) => turn.final && turn.id !== job.turnId && turn.transcriptionStatus !== 'checking')
        .slice(-6)
        .map((turn) => turn.text)
        .join(' ')
        .slice(0, 800);
      const result = await requestAccurateTranscription(
        job.captured.audio,
        job.captured.sampleRate,
        context,
        controller.signal,
      );
      if (
        !this.#accurateTranscriptionEnabled ||
        job.generation !== this.#transcriptionGeneration ||
        controller.signal.aborted
      ) {
        outcome = 'idle';
        return;
      }
      if (result) {
        actions.recordAssistUsage('transcription', result.usage);
        if (actions.applyAccurateTranscription(job.turnId, job.expectedText, result.text)) {
          outcome = 'ready';
          resultCount = 1;
          return;
        }
      }
      actions.finishAccurateTranscription(job.turnId, job.expectedText);
    } finally {
      this.#transcriptionControllers.delete(controller);
      if (outcome === 'idle') actions.finishAccurateTranscription(job.turnId, job.expectedText);
      actions.finishAssistTask('corrections', outcome, resultCount, job.taskId);
    }
  }

  /** Discard a profile that has merged two people, so they can separate again. */
  forgetSpeaker(id: string): void {
    this.speakers.forget(id);
    actions.setSpeakers(this.speakers.profiles(), [...this.speakers.attempts()], this.speakers.pendingCount());
  }

  /** Rename a voice, and remember it was the user's own if they say so. */
  renameSpeaker(id: string, label: string): void {
    this.speakers.rename(id, label);
    actions.setSpeakers(this.speakers.profiles(), [...this.speakers.attempts()], this.speakers.pendingCount());
  }

  markSpeakerAsOwner(id: string): void {
    this.speakers.markAsOwner(id);
    actions.setSpeakers(this.speakers.profiles(), [...this.speakers.attempts()], this.speakers.pendingCount());
  }

  // -------------------------------------------------------------------------
  // Recognition results
  // -------------------------------------------------------------------------

  #onRecognition(
    channel: 'local' | 'remote',
    text: string,
    final: boolean,
    words: WordConfidence[] | null = null,
  ): void {
    const trimmed = text.trim();

    if (trimmed.length === 0) {
      if (final) this.#interimTurns.delete(channel);
      return;
    }

    // Dictation goes straight into the conversation, always: continuous
    // transcription, updated in place as the words firm up. Marked as
    // dictated, because it was heard rather than spoken aloud or sent.
    if (channel === 'local') {
      let id = this.#interimTurns.get('local');
      if (!id) {
        id = createId('turn');
        this.#interimTurns.set('local', id);
      }
      // Attribution needs the whole utterance, so the sample is captured
      // at the final result — synchronously, before the next utterance
      // starts filling the buffers — and the speaker label lands on the
      // turn a moment later, once the voiceprint network has answered.
      const captured = final ? this.#captureUtterance() : null;
      const finalText = final ? restorePunctuation(trimmed) : trimmed;
      const capturedSamples = captured?.audio.reduce((total, frame) => total + frame.length, 0) ?? 0;
      const willCheck = Boolean(
        final &&
        captured &&
        this.#accurateTranscriptionEnabled &&
        capturedSamples >= AacSession.#MIN_TRANSCRIPTION_SAMPLES,
      );
      actions.upsertTurn({
        id,
        source: 'user',
        text: finalText,
        final,
        dictated: true,
        spoken: false,
        ...(final && words ? { words } : {}),
        ...(final ? { transcriptionStatus: willCheck ? 'checking' as const : 'local' as const } : {}),
      });
      if (captured) {
        void this.#attributeCaptured(id, captured);
        if (willCheck) this.#queueAccurateTranscription(id, finalText, captured);
      }
      if (final) this.#interimTurns.delete('local');
      return;
    }

    // The partner's own text wins over our transcription of their audio.
    if (this.#peerSendsRtt) return;

    const source = 'peer';

    let id = this.#interimTurns.get(channel);
    if (!id) {
      id = createId('turn');
      this.#interimTurns.set(channel, id);
    }

    actions.upsertTurn({
      id,
      source,
      text: final ? restorePunctuation(trimmed) : trimmed,
      final,
      spoken: false,
      viaRtt: false,
      ...(final && words ? { words } : {}),
    });

    if (!final) return;

    this.#interimTurns.delete(channel);

    // Suggestions are never generated unprompted any more: the popped-up
    // "on-device" recommendations read as the machine talking out of turn.
    // An attached agent can still propose replies through its tools, and the
    // Checks simulator can still exercise the ladder explicitly.
  }

  // -------------------------------------------------------------------------
  // Speaking
  // -------------------------------------------------------------------------

  /**
   * Synthesise and broadcast a message.
   *
   * The text goes out over the data channel *first*. If synthesis is slow, or
   * the voice cannot be routed to the peer at all, the partner still receives
   * the words — which is what RAUR Need 13 is protecting.
   */
  async speak(text: string, options: { addTurn?: boolean } = {}): Promise<void> {
    const message = text.trim();
    if (message.length === 0) return;

    const settings = store.getState().settings;
    const turn: Turn | null =
      options.addTurn === false ? null : actions.addTurn('user', message, { spoken: false });

    // Finalise the line the partner has been watching form, rather than
    // stranding it and appending a duplicate underneath.
    const rttId = this.#composingRttId ?? turn?.id;
    this.#composingRttId = null;
    this.#peer?.sendRtt(message, true, rttId);

    store.set({ speaking: true });
    try {
      if (this.#tts.routable) {
        const audio = await this.#tts.synthesize({
          text: message,
          voiceId: settings.voiceId ?? undefined,
          rate: settings.speechRate,
        });
        await this.graph.playSynthesis(audio.samples, audio.sampleRate);
      } else if (this.#tts.speakDirect) {
        await this.#tts.speakDirect({
          text: message,
          voiceId: settings.voiceId ?? undefined,
          rate: settings.speechRate,
        });
      } else {
        throw new Error('No usable synthesis engine.');
      }

      if (turn) actions.upsertTurn({ ...turn, spoken: true });
    } catch (error) {
      actions.notify('error', `Could not speak: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      store.set({ speaking: false });
    }
  }

  /** Speak whatever is in the composition buffer, then clear it. */
  async speakComposition(): Promise<void> {
    const text = store.getState().composition.trim();
    if (text.length === 0) return;
    actions.clearComposition();
    // The words cannot be unsaid, but an accidental Speak must not cost the
    // sentence: keep it so the ribbon can offer to restore it for repair.
    actions.setLastSpoken(text);
    await this.speak(text);
  }

  /**
   * Say a short sample in a candidate voice, locally only: no turn is added,
   * nothing is sent to a call partner. Choosing a voice is done by ear.
   */
  async previewVoice(voiceId: string): Promise<void> {
    const text = 'Hello — this is how I sound.';
    const rate = store.getState().settings.speechRate;
    try {
      if (this.#tts.routable) {
        const audio = await this.#tts.synthesize({ text, voiceId, rate });
        await this.graph.playSynthesis(audio.samples, audio.sampleRate);
      } else if (this.#tts.speakDirect) {
        await this.#tts.speakDirect({ text, voiceId, rate });
      }
    } catch (error) {
      actions.notify('error', `Could not preview: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  stopSpeaking(): void {
    this.graph.stopSynthesis();
    this.#tts.cancel();
    store.set({ speaking: false });
  }

  // -------------------------------------------------------------------------
  // Prediction
  // -------------------------------------------------------------------------

  schedulePrediction(): void {
    if (this.#predictionTimer) clearTimeout(this.#predictionTimer);
    this.#predictionTimer = setTimeout(() => void this.predictNow(), PREDICTION_DEBOUNCE_MS);
  }

  async predictNow(): Promise<void> {
    const state = store.getState();
    actions.setPredicting(true);

    const outcome = await predictionEngine.predict({
      turns: selectContextWindow(state).map((turn) => ({ source: turn.source, text: turn.text })),
      composition: state.composition,
    });

    actions.setPredictions(outcome.suggestions.map((text) => ({ text, source: outcome.source })));
    if (outcome.fallbackReason) console.info('[aac] prediction fell back —', outcome.fallbackReason);
  }

  async expandComposition(): Promise<string> {
    const state = store.getState();
    const shorthand = state.composition.trim();
    if (shorthand.length === 0) return '';

    const outcome = await predictionEngine.expand(shorthand, {
      turns: selectContextWindow(state).map((turn) => ({ source: turn.source, text: turn.text })),
      composition: shorthand,
    });

    // Whichever engine expanded it, the result is machine-written text the
    // user has not read yet — mark it so until they edit or speak it.
    actions.setComposition(outcome.text, 'agent');
    return outcome.text;
  }

  // -------------------------------------------------------------------------
  // Calls
  // -------------------------------------------------------------------------

  async joinCall(roomCode?: string): Promise<string> {
    const room = (roomCode ?? createRoomCode()).trim().toUpperCase();
    store.set({ roomCode: room, callHost: !roomCode });

    // Short-lived TURN credentials are minted by the origin, not shipped in the
    // bundle. Resolved here so every call gets fresh ones.
    const ice = await loadIceConfiguration();
    if (ice.degraded && ice.detail) {
      actions.notify('warning', `${ice.detail} Calls may fail on restrictive networks.`);
    }

    const peer = new PeerSession({
      signalingUrl: config.signalingUrl,
      iceServers: ice.iceServers,
      displayName: 'AAC user',
    });
    this.#peer = peer;

    peer.events.on('state', (call) => store.set({ call }));
    peer.events.on('signaling', (signaling) => store.set({ signaling }));
    peer.events.on('rtt-channel', (rttReady) => store.set({ rttReady }));
    peer.events.on('error', (error) => actions.notify('error', error.message));

    peer.events.on('track', (stream) => {
      this.graph.attachRemoteStream(stream);
      void this.graph.resume();
    });

    peer.events.on('message', (message) => {
      switch (message.t) {
        case 'rtt': {
          // From here on their typed text is authoritative; stop duplicating it
          // with our own transcription of their synthesised speech.
          this.#peerSendsRtt = true;
          this.#asr.reset('remote');

          // An empty final message is a retraction: the partner cleared what
          // they were typing, so the line should disappear, not sit there blank.
          if (message.text.trim().length === 0) {
            if (message.final) actions.removeTurn(message.id);
            break;
          }
          // The partner's own text, authoritative over our transcription of it.
          actions.upsertTurn({
            id: message.id,
            source: 'peer',
            text: message.text,
            final: message.final,
            viaRtt: true,
            spoken: false,
          });
          break;
        }
        case 'hello':
          store.set({ peerName: message.displayName });
          break;
        case 'state':
          store.set({ peerEmergency: message.emergencyOverride });
          break;
      }
    });

    // Attach the synthetic-voice track before the first offer so no
    // renegotiation is needed before the user can speak.
    peer.setOutboundTrack(this.graph.outboundTrack, this.graph.peerStream);
    await peer.join(room);
    return room;
  }

  hangUp(): void {
    this.#peer?.hangUp();
    this.#peer = null;
    this.#composingRttId = null;
    this.#peerSendsRtt = false;
    this.graph.detachRemoteStream();
    this.#asr.reset('remote');
    store.set({ call: 'idle', callHost: false, rttReady: false, peerName: null, peerEmergency: false });
  }

  /** Live RTT: transmit the composition as it is typed (RAUR Need 13). */
  sendComposingUpdate(text: string): void {
    const { rttReady } = store.getState();
    if (!rttReady) return;

    if (text.trim().length === 0) {
      // Retract the in-progress line instead of leaving it hanging.
      if (this.#composingRttId) {
        this.#peer?.sendRtt('', true, this.#composingRttId);
        this.#composingRttId = null;
      }
      return;
    }

    this.#composingRttId ??= createId('rtt');
    this.#peer?.sendRtt(text, false, this.#composingRttId);
  }

  // -------------------------------------------------------------------------
  // Emergency override (RAUR Need 11)
  // -------------------------------------------------------------------------

  setEmergencyOverride(enabled: boolean): void {
    this.graph.setEmergencyOverride(enabled);
    store.set({ emergencyOverride: enabled });
    this.#peer?.sendState(enabled, false);
    actions.notify(
      enabled ? 'warning' : 'info',
      enabled
        ? 'Emergency override on. Incoming audio is muted and your voice is at full volume.'
        : 'Emergency override off. Normal audio restored.',
    );
  }

  // -------------------------------------------------------------------------

  #publishPlatform(): void {
    const platform = detectPlatform();
    store.set({
      crossOriginIsolated: platform.crossOriginIsolated,
      sharedArrayBufferAvailable: platform.sharedArrayBuffer,
      hardwareConcurrency: platform.hardwareConcurrency,
      webMcpAvailable: isWebMcpAvailable(),
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
    });

    if (!platform.crossOriginIsolated) {
      actions.notify(
        'warning',
        'Cross-origin isolation is off, so speech models run single-threaded. Check that COOP and COEP headers survive your CDN.',
      );
    }
  }

  #onConnectivityChange = (): void => {
    store.set({ online: navigator.onLine });
  };
}

export const session = new AacSession();
