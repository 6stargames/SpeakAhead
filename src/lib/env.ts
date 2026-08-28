/**
 * Typed, validated access to build-time configuration.
 *
 * Every value has a working default so a fresh clone boots with no `.env` file.
 */

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

const env = import.meta.env as Record<string, string | undefined>;

/** Strip a trailing slash so callers can always do `${base}/file`. */
function normaliseBase(value: string): string {
  return value.replace(/\/+$/, '');
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

function parseIceServers(raw: string | undefined): RTCIceServer[] {
  if (!raw) return DEFAULT_ICE_SERVERS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ICE_SERVERS;
    return parsed as RTCIceServer[];
  } catch (error) {
    console.warn('[env] VITE_ICE_SERVERS is not valid JSON; falling back to STUN only.', error);
    return DEFAULT_ICE_SERVERS;
  }
}

/**
 * Where to signal.
 *
 * Empty means same-origin HTTP long-polling, which is the default because
 * Firebase App Hosting's edge refuses WebSocket upgrades. Set a `ws://` or
 * `wss://` URL to point at a standalone regional signalling server, which does
 * support them; anything else is treated as an HTTP origin.
 */
function resolveSignalingUrl(raw: string | undefined): string {
  return raw && raw.trim().length > 0 ? raw.trim() : '';
}

/**
 * Default model locations.
 *
 * The Sherpa release version is part of the path on purpose. Model files are
 * served `immutable`, so changing a bundle has to change its URL — otherwise
 * browsers and the CDN keep serving last year's model to code that expects the
 * new one. `npm run fetch:models` prints the paths it installed.
 */
export const config = {
  asrBase: normaliseBase(readString(env.VITE_SHERPA_ASR_BASE, '/models/asr-v1.13.6')),
  ttsBase: normaliseBase(readString(env.VITE_SHERPA_TTS_BASE, '/models/tts-v1.12.37')),
  vadBase: normaliseBase(readString(env.VITE_SHERPA_VAD_BASE, '/models/vad-v1.13.6')),
  /** Empty string disables the spec's optional second decoding pass. */
  refineBase: normaliseBase(readString(env.VITE_SHERPA_REFINE_BASE, '')),
  /**
   * The CAM++ speaker-verification network (3D-Speaker, VoxCeleb English),
   * run via onnxruntime-web to attribute utterances to voices. Empty string
   * disables the neural path; the pitch-and-timbre heuristics carry on alone.
   */
  speakerModelUrl: readString(env.VITE_SPEAKER_MODEL_URL, '/models/speaker-v1/campplus-en-voxceleb.onnx'),
  signalingUrl: resolveSignalingUrl(env.VITE_SIGNALING_URL),
  iceServers: parseIceServers(env.VITE_ICE_SERVERS),
  buildTime: __BUILD_TIME__,
} as const;

export type AppConfig = typeof config;
