import { describe, expect, it } from 'vitest';
import {
  assertCompliance,
  evaluateCompliance,
  RaurViolationError,
  RoutingGraph,
} from '@/audio/routing';

/** The topology AacAudioGraph builds for a live call, expressed declaratively. */
function buildCompliantGraph(): RoutingGraph {
  const graph = new RoutingGraph();
  graph.connect('tts', 'tts-bus');
  graph.connect('tts-bus', 'local-monitor');
  graph.connect('local-monitor', 'speakers');
  graph.connect('tts-bus', 'peer');
  graph.connect('microphone', 'mic-splitter');
  graph.connect('mic-splitter', 'mic-capture');
  graph.connect('mic-capture', 'asr');
  graph.connect('browser-tab', 'tab-capture');
  graph.connect('tab-capture', 'asr');
  graph.connect('remote', 'remote-monitor');
  graph.connect('remote-monitor', 'speakers');
  graph.connect('remote', 'remote-capture');
  graph.connect('remote-capture', 'asr');
  return graph;
}

describe('RoutingGraph', () => {
  it('finds paths through intermediate nodes', () => {
    const graph = buildCompliantGraph();
    expect(graph.pathExists('tts', 'speakers')).toBe(true);
    expect(graph.pathExists('tts', 'peer')).toBe(true);
    expect(graph.pathExists('remote', 'asr')).toBe(true);
    expect(graph.pathExists('browser-tab', 'asr')).toBe(true);
    expect(graph.pathExists('browser-tab', 'speakers')).toBe(false);
    expect(graph.pathExists('browser-tab', 'peer')).toBe(false);
  });

  it('terminates on cycles rather than recursing forever', () => {
    const graph = new RoutingGraph();
    graph.connect('tts', 'tts-bus');
    graph.connect('tts-bus', 'tts');
    expect(graph.pathExists('tts', 'peer')).toBe(false);
  });

  it('reports every distinct path for the verification panel', () => {
    const graph = buildCompliantGraph();
    expect(graph.tracePaths('tts', 'speakers')).toEqual([
      ['tts', 'tts-bus', 'local-monitor', 'speakers'],
    ]);
  });

  it('removes all outgoing edges when a node is disconnected wholesale', () => {
    const graph = buildCompliantGraph();
    graph.disconnect('remote');
    expect(graph.pathExists('remote', 'asr')).toBe(false);
    expect(graph.pathExists('remote', 'speakers')).toBe(false);
  });
});

/** What the graph looks like with the microphone on but no call in progress. */
function buildDictationOnlyGraph(): RoutingGraph {
  const graph = new RoutingGraph();
  graph.connect('tts', 'tts-bus');
  graph.connect('tts-bus', 'local-monitor');
  graph.connect('local-monitor', 'speakers');
  graph.connect('tts-bus', 'peer');
  graph.connect('microphone', 'mic-splitter');
  graph.connect('mic-splitter', 'mic-capture');
  graph.connect('mic-capture', 'asr');
  return graph;
}

describe('dictation without a call', () => {
  const noCall = { callActive: false, micActive: true, emergencyOverride: false };

  it('permits the microphone when no peer exists', () => {
    // Regression: asserting the whole rule set here failed on
    // Spec/contextual-harvesting, which describes the *remote* peer's audio.
    // Turning on the microphone threw unless a call was already connected, so
    // dictation could never be used on its own.
    expect(() => assertCompliance(buildDictationOnlyGraph(), noCall)).not.toThrow();
  });

  it('still forbids the microphone reaching the peer with no call active', () => {
    const graph = buildDictationOnlyGraph();
    graph.connect('mic-splitter', 'peer');
    expect(() => assertCompliance(graph, noCall)).toThrow(RaurViolationError);
  });

  it('still forbids the microphone reaching the speakers with no call active', () => {
    const graph = buildDictationOnlyGraph();
    graph.connect('mic-capture', 'speakers');
    expect(() => assertCompliance(graph, noCall)).toThrow(RaurViolationError);
  });

  it('drops the peer rules only when there is genuinely no call', () => {
    // With a call active the same graph must be judged in full, and this one
    // has no remote audio reaching the recogniser.
    expect(() =>
      assertCompliance(buildDictationOnlyGraph(), {
        callActive: true,
        micActive: true,
        emergencyOverride: false,
      }),
    ).toThrow(RaurViolationError);
  });
});

describe('compliance rules', () => {
  it('accepts the topology the audio graph actually builds', () => {
    expect(() => assertCompliance(buildCompliantGraph())).not.toThrow();
    expect(evaluateCompliance(buildCompliantGraph()).every((rule) => rule.satisfied)).toBe(true);
  });

  it('rejects the microphone reaching the peer - the BIPA failure', () => {
    const graph = buildCompliantGraph();
    graph.connect('mic-splitter', 'peer');

    expect(() => assertCompliance(graph)).toThrow(RaurViolationError);

    const failures = evaluateCompliance(graph).filter((rule) => !rule.satisfied);
    expect(failures.map((rule) => rule.id)).toContain('BIPA/mic-never-leaves-device');
  });

  it('catches an indirect microphone leak through the TTS bus', () => {
    const graph = buildCompliantGraph();
    // The plausible mistake: routing the mic somewhere that is itself outbound.
    graph.connect('mic-splitter', 'tts-bus');

    const failures = evaluateCompliance(graph).filter((rule) => !rule.satisfied);
    expect(failures.map((rule) => rule.id)).toContain('BIPA/mic-never-leaves-device');
    expect(failures.map((rule) => rule.id)).toContain('RAUR-5/no-microphone-monitoring');
  });

  it('rejects a topology where the user cannot hear their own voice', () => {
    const graph = buildCompliantGraph();
    graph.disconnect('tts-bus', 'local-monitor');

    const failures = evaluateCompliance(graph).filter((rule) => !rule.satisfied);
    expect(failures.map((rule) => rule.id)).toContain('RAUR-5/user-monitors-own-output');
  });

  it('names the offending requirement in the thrown error', () => {
    const graph = buildCompliantGraph();
    graph.connect('microphone', 'peer');
    try {
      assertCompliance(graph);
      expect.unreachable('assertCompliance should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RaurViolationError);
      expect((error as RaurViolationError).message).toContain('Biometric Information Privacy Act');
    }
  });
});
