import { useRef, type JSX } from 'react';
import type { AppState } from '@/state/store';
import { useStore } from '@/state/store';
import type { EngineInfo } from '@/speech/types';
import { formatLoadPercent } from '@/lib/progress';

type ChipTone = 'ok' | 'warn' | 'bad' | 'neutral';

function Chip({ tone, label, title }: { tone: ChipTone; label: string; title?: string }): JSX.Element {
  const toneClass = tone === 'neutral' ? '' : ` chip--${tone}`;
  return (
    <span className={`chip${toneClass}`} title={title}>
      <span className="chip__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function engineTone(info: EngineInfo): ChipTone {
  switch (info.status) {
    case 'ready':
      return info.offline ? 'ok' : 'warn';
    case 'loading':
      return 'neutral';
    case 'error':
      return 'bad';
    default:
      return 'warn';
  }
}

/**
 * Loading is only worth reporting in detail when it is slow enough to worry
 * about. Models are cached by the service worker after first use, so a repeat
 * visit reads them from disk in a moment — flashing "loading 9%" on the way is
 * noise that makes a fast load look like a struggling one.
 */
const PROGRESS_VISIBLE_AFTER_MS = 1500;

function engineLabel(prefix: string, info: EngineInfo, loadingSince: number | null): string {
  switch (info.status) {
    case 'ready':
      return `${prefix}: ${info.implementation === 'sherpa-onnx' ? 'on-device' : 'platform'}`;
    case 'loading': {
      // A cached load finishes in a moment; showing it tick through percentages
      // makes a fast start look like a struggling one.
      if (loadingSince !== null && Date.now() - loadingSince < PROGRESS_VISIBLE_AFTER_MS) {
        return `${prefix}: loading`;
      }
      // Sherpa reports "Downloading data... (n/total)"; turn it into a percentage
      // so a minute-long first load looks like progress, not a hang.
      const percent = formatLoadPercent(info.detail);
      return percent === null ? `${prefix}: loading` : `${prefix}: loading ${percent}%`;
    }
    case 'unavailable':
      return `${prefix}: unavailable`;
    case 'error':
      return `${prefix}: error`;
    default:
      return `${prefix}: idle`;
  }
}

const selectStatus = (state: AppState) => ({
  asr: state.asr,
  tts: state.tts,
  isolated: state.crossOriginIsolated,
  sab: state.sharedArrayBufferAvailable,
  online: state.online,
  webMcp: state.webMcpAvailable,
  call: state.call,
  emergency: state.emergencyOverride,
});

export function StatusBar(): JSX.Element {
  const status = useStore(selectStatus);

  // When each engine started loading, so a fast cached start does not flash a
  // percentage on its way past. Refs, not state: this must not cause renders.
  const loadingSince = useRef<{ asr: number | null; tts: number | null }>({ asr: null, tts: null });
  for (const engine of ['asr', 'tts'] as const) {
    if (status[engine].status === 'loading') loadingSince.current[engine] ??= Date.now();
    else loadingSince.current[engine] = null;
  }

  return (
    <div className="status-chips">
      {/* The privacy guarantee, stated first and always: audio and voiceprints
          are processed on this device. The people being heard never signed a
          biometric consent form, so this is a promise the interface must make
          visibly, not a detail for a settings page. */}
      <Chip
        tone="ok"
        label="Private · audio stays on this device"
        title="Speech recognition, voice separation and synthesis all run locally. No audio or voiceprint ever leaves this device."
      />

      <Chip
        tone={engineTone(status.asr)}
        label={engineLabel('Listening', status.asr, loadingSince.current.asr)}
        title={status.asr.detail}
      />
      <Chip
        tone={engineTone(status.tts)}
        label={engineLabel('Voice', status.tts, loadingSince.current.tts)}
        title={status.tts.detail}
      />

      <Chip
        tone={status.isolated && status.sab ? 'ok' : 'warn'}
        label={status.isolated && status.sab ? 'Isolated · threads on' : 'Single-threaded'}
        title={
          status.isolated
            ? 'Cross-origin isolation is active and SharedArrayBuffer is available, so inference can use multiple threads.'
            : 'COOP/COEP headers are missing or SharedArrayBuffer is blocked. Inference will run on one thread.'
        }
      />

      <Chip
        tone={status.webMcp ? 'ok' : 'neutral'}
        label={status.webMcp ? 'Agent attached' : 'No agent'}
        title={
          status.webMcp
            ? 'A WebMCP agent surface is present; registered tools are discoverable.'
            : 'No WebMCP surface in this browser. On-device prediction is used instead.'
        }
      />

      <Chip
        tone={status.online ? 'neutral' : 'ok'}
        label={status.online ? 'Online' : 'Offline · fully working'}
        title={
          status.online
            ? 'Network available. Calls are possible.'
            : 'No network. Speech recognition and synthesis continue to run on-device.'
        }
      />

      {status.call !== 'idle' && (
        <Chip
          tone={status.call === 'connected' ? 'ok' : status.call === 'failed' ? 'bad' : 'warn'}
          label={`Call: ${status.call}`}
        />
      )}

      {status.emergency && <Chip tone="bad" label="Emergency override" />}
    </div>
  );
}
