import { useCallback, useEffect, useState, type JSX } from 'react';
import { detectPlatform, usableThreadCount } from '@/lib/platform';
import { config } from '@/lib/env';
import { session } from '@/session/AacSession';
import { actions, selectCompliance, useStore, type AppState } from '@/state/store';
import { toolRegistry } from '@/webmcp/registry';
import { probeIceServers, type IceProbeResult } from '@/webrtc/ice';
import { loadIceConfiguration } from '@/webrtc/iceConfig';
import { StatusBar } from './StatusBar';
import type { RoutingEdge } from '@/audio/routing';

const selectSpeakerModel = (state: AppState) => state.speakerModel;
const selectVoiceAttempts = (state: AppState) => state.voiceAttempts;

const selectVerification = (state: AppState) => ({
  micPermission: state.micPermission,
  micActive: state.micActive,
  micError: state.micError,
  isolated: state.crossOriginIsolated,
  sab: state.sharedArrayBufferAvailable,
  cores: state.hardwareConcurrency,
  webMcp: state.webMcpAvailable,
  audio: state.audio,
  asr: state.asr,
  tts: state.tts,
});

/** The transcript the specification's WebMCP protocol asks to be injected. */
const SAMPLE_PARTNER_TURN = 'What would you like to drink with your lunch today?';

/**
 * Say plainly why the microphone is off.
 *
 * Diagnosing this by inspection cost far more time than the check is worth -
 * several rounds of guessing at which condition was short-circuiting. A single
 * line naming the reason turns that into a glance.
 */
function explainNotListening(status: {
  micActive: boolean;
  micPermission: string;
  micError: string | null;
}): string {
  if (status.micActive) return 'It is listening.';
  if (status.micPermission === 'denied') return 'The browser is blocking the microphone for this site.';
  if (status.micError) return status.micError;
  return 'No reason recorded - it should be listening. Please report this.';
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '-';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The specification's confirmation protocols, made executable.
 *
 * Most of them are written as manual console checks or two-device rituals. The
 * parts that can be evaluated in-process are evaluated here and shown as
 * pass/fail, so a regression surfaces during development rather than during a
 * QA session in two rooms with two laptops.
 */
export function VerificationPanel(): JSX.Element {
  const compliance = useStore(selectCompliance);
  const status = useStore(selectVerification);
  const speakerModel = useStore(selectSpeakerModel);
  const voiceAttempts = useStore(selectVoiceAttempts);
  const [edges, setEdges] = useState<RoutingEdge[]>([]);
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [lastToolResult, setLastToolResult] = useState<string>('');
  const [probe, setProbe] = useState<IceProbeResult | null>(null);
  const [turnProvider, setTurnProvider] = useState<string | null>(null);

  // Network readiness runs itself: opening this page IS the question "is
  // everything working?", and a relay check nobody remembers to press is a
  // relay check that happens during the emergency instead of before it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ice = await loadIceConfiguration({ force: true });
        if (cancelled) return;
        setTurnProvider(ice.provider);
        const result = await probeIceServers(ice.iceServers);
        if (!cancelled) setProbe(result);
      } catch {
        /* The probe row keeps showing "checking…" hints; failures surface in results. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const platform = detectPlatform();

  useEffect(() => {
    const refresh = () => setEdges(session.graph.edges());
    refresh();
    return session.graph.events.on('compliance', refresh);
  }, []);

  useEffect(() => {
    const refresh = () => setToolNames(toolRegistry.list().map((tool) => tool.name));
    refresh();
    return toolRegistry.events.on('change', refresh);
  }, []);

  const runAgentSimulation = useCallback(async () => {
    // Inject a partner turn and confirm the remaining read-only WebMCP context
    // surface returns it without needing a browser agent implementation.
    actions.addTurn('peer', SAMPLE_PARTNER_TURN, { viaRtt: true });
    const context = await toolRegistry.invoke('get-conversation-context', {});
    setLastToolResult(context.content?.[0]?.text ?? '(no context returned)');
  }, []);

  return (
    <div className="panel">
      {/* The at-a-glance system state, relocated from the old top bar: this
          page is where someone comes to ask "is everything working?". */}
      <StatusBar />

      <h3 className="panel__title">Network readiness</h3>
      <p className="field__hint" style={{ marginBottom: '0.75rem' }}>
        Whether a relay path exists before you need it. Hospital and school networks commonly block
        direct connections. This check runs automatically when the page opens.
      </p>
      {probe === null ? (
        <p className="field__hint" style={{ marginBottom: '1rem' }}>
          Checking…
        </p>
      ) : (
        <dl className="kv">
          <dt>STUN</dt>
          <dd>{probe.stunReachable ? 'Reachable' : 'Not reachable'}</dd>
          <dt>TURN relay</dt>
          <dd>
            {probe.turnConfigured
              ? probe.turnReachable
                ? 'Reachable'
                : 'Configured but unreachable'
              : 'Not configured'}
          </dd>
          <dt>Candidates</dt>
          <dd>{probe.candidateTypes.join(', ') || 'none'}</dd>
          <dt>Credential source</dt>
          <dd>{turnProvider ?? 'unknown'}</dd>
          <dt>Result</dt>
          <dd style={{ fontWeight: 400 }}>{probe.detail}</dd>
        </dl>
      )}

      <h2 className="panel__title">Audio compliance</h2>
      <ul className="rules">
        {compliance.length === 0 && <li className="rule">Audio graph has not started yet.</li>}
        {compliance.map((rule) => (
          <li key={rule.id} className={`rule ${rule.satisfied ? 'rule--pass' : 'rule--fail'}`}>
            <span className="rule__icon" aria-hidden="true">
              {rule.satisfied ? '✓' : '✕'}
            </span>
            <div>
              <span className="rule__id">{rule.id}</span>
              <span className="visually-hidden">{rule.satisfied ? ' passes' : ' fails'}</span>
              <p className="rule__text">{rule.requirement}</p>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="panel__title">Live routing matrix</h3>
      <table className="matrix">
        <caption className="visually-hidden">Every connection currently present in the audio graph</caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
          </tr>
        </thead>
        <tbody>
          {edges.length === 0 && (
            <tr>
              <td colSpan={2}>No connections yet.</td>
            </tr>
          )}
          {edges.map((edge) => (
            <tr key={`${edge.from}->${edge.to}`}>
              <td>
                <code>{edge.from}</code>
              </td>
              <td>
                <code>{edge.to}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="panel__title" style={{ marginTop: '1.5rem' }}>
        Environment
      </h3>
      <dl className="kv">
        <dt>Cross-origin isolated</dt>
        <dd>{status.isolated ? 'yes' : 'no'}</dd>
        <dt>SharedArrayBuffer</dt>
        <dd>{status.sab ? 'function' : 'undefined'}</dd>
        <dt>WebAssembly threads</dt>
        <dd>{platform.webAssemblyThreads ? 'supported' : 'unsupported'}</dd>
        <dt>Usable inference threads</dt>
        <dd>{usableThreadCount(platform)} of {status.cores} cores</dd>
        <dt>Secure context</dt>
        <dd>{platform.secureContext ? 'yes' : 'no'}</dd>
        <dt>Capture rate</dt>
        <dd>
          {status.audio ? `${status.audio.captureSampleRate} Hz` : '-'}
          {status.audio?.resamplingCapture ? ' (worklet resampling)' : ''}
        </dd>
        <dt>Playback rate</dt>
        <dd>{status.audio ? `${status.audio.playbackSampleRate} Hz` : '-'}</dd>
        <dt>Recogniser heap</dt>
        <dd>{formatBytes(status.asr.heapBytes)}</dd>
        <dt>Synthesiser heap</dt>
        <dd>{formatBytes(status.tts.heapBytes)}</dd>
        <dt>Listening</dt>
        <dd>{status.micActive ? 'active' : 'not listening'}</dd>
        <dt>Microphone permission</dt>
        <dd>{status.micPermission}</dd>
        <dt>Why not listening</dt>
        <dd style={{ fontWeight: 400 }}>{explainNotListening(status)}</dd>
        <dt>Build</dt>
        <dd>
          {/* Which code this tab is actually running - the first question when
              a bug that was fixed appears to happen again. */}
          <code>{config.buildTime}</code>
        </dd>
        <dt>Model source</dt>
        <dd>
          <code>{config.asrBase}</code>
        </dd>
        <dt>Voiceprint network</dt>
        <dd>
          {speakerModel.status === 'ready' && '✓ '}
          {speakerModel.status === 'error' && '✕ '}
          {speakerModel.status}
          <span style={{ fontWeight: 400 }}> - {speakerModel.detail}</span>
        </dd>
        <dt>Voiceprint source</dt>
        <dd>
          <code>{config.speakerModelUrl || '(disabled)'}</code>
        </dd>
      </dl>

      <h3 className="panel__title" style={{ marginTop: '1.5rem' }}>
        Recent voice attributions
      </h3>
      <p className="field__hint" style={{ marginBottom: '0.75rem' }}>
        What the voice separator measured for each finished utterance. When the voiceprint network
        is loaded, voices are matched by it - results say <strong>voiceprint</strong>, with 0.55+ a
        confident match. Results saying <strong>timbre</strong> mean the network had not answered
        yet and the on-device heuristics decided instead; they are far weaker. Pitch is only ever
        the tie-breaker.
      </p>
      {voiceAttempts.length === 0 ? (
        <p className="field__hint">Nothing heard yet.</p>
      ) : (
        <table className="matrix">
          <caption className="visually-hidden">Recent voice attribution attempts</caption>
          <thead>
            <tr>
              <th scope="col">Pitch</th>
              <th scope="col">Frames</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {[...voiceAttempts].reverse().map((attempt) => (
              <tr key={attempt.at}>
                <td>{attempt.pitchHz === null ? '-' : `${attempt.pitchHz} Hz`}</td>
                <td>{attempt.voicedFrames}</td>
                <td>
                  {attempt.speakerId ? `${attempt.speakerId} · ` : ''}
                  {attempt.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="panel__title" style={{ marginTop: '1.5rem' }}>
        WebMCP
      </h3>
      <dl className="kv">
        <dt>Agent surface</dt>
        <dd>{status.webMcp ? 'present' : 'absent - tools are local only'}</dd>
        <dt>Registered tools</dt>
        <dd>{toolNames.length > 0 ? toolNames.join(', ') : 'none'}</dd>
      </dl>

      <p className="field__hint" style={{ marginBottom: '0.75rem' }}>
        This check reads the registered conversation context directly, even when the browser does not implement WebMCP.
      </p>
      <div className="composer__actions">
        <button type="button" className="button" onClick={() => void runAgentSimulation()}>
          Test conversation context
        </button>
      </div>

      {lastToolResult && (
        <pre
          style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8em',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {lastToolResult}
        </pre>
      )}
    </div>
  );
}
