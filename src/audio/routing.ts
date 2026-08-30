/**
 * Declarative model of the AAC audio topology.
 *
 * The specification's routing table is a set of claims about which signals may
 * reach which destinations. Claims that live only in prose rot. So every edge
 * the runtime creates in Web Audio is *also* recorded here, and the compliance
 * rules are evaluated as graph reachability over this model.
 *
 * This module is deliberately free of Web Audio types so it can be unit tested
 * in isolation and reasoned about on its own.
 */

export type AudioNodeId =
  /** Physical microphone. Biometric source - BIPA-sensitive. */
  | 'microphone'
  /** ChannelSplitterNode isolating the mic's first channel. */
  | 'mic-splitter'
  /** AudioWorklet capturing mic PCM for local inference. Zero outputs. */
  | 'mic-capture'
  /** The WebAssembly recogniser. A terminal, device-local sink. */
  | 'asr'
  /** Synthesised AAC voice emitted by the WASM vocoder. */
  | 'tts'
  /** Gain bus every synthesis job is routed through. */
  | 'tts-bus'
  /** User's own monitoring path. */
  | 'local-monitor'
  /** AudioContext.destination - the physical speakers. */
  | 'speakers'
  /** MediaStreamAudioDestinationNode handed to RTCPeerConnection.addTrack. */
  | 'peer'
  /** Inbound MediaStreamTrack from RTCTrackEvent. */
  | 'remote'
  /** Gain stage for remote audio monitoring. */
  | 'remote-monitor'
  /** AudioWorklet capturing remote PCM for conversational context. */
  | 'remote-capture';

export interface RoutingEdge {
  readonly from: AudioNodeId;
  readonly to: AudioNodeId;
}

export interface ComplianceRule {
  readonly id: string;
  /** Human-readable requirement, quoted from RAUR or the BIPA mandate. */
  readonly requirement: string;
  readonly evaluate: (graph: RoutingGraph) => boolean;
}

export interface ComplianceResult {
  readonly id: string;
  readonly requirement: string;
  readonly satisfied: boolean;
}

export class RaurViolationError extends Error {
  readonly violations: readonly ComplianceResult[];

  constructor(violations: readonly ComplianceResult[]) {
    const detail = violations.map((v) => `  • ${v.id}: ${v.requirement}`).join('\n');
    super(`Audio topology violates accessibility/privacy invariants:\n${detail}`);
    this.name = 'RaurViolationError';
    this.violations = violations;
  }
}

/** Directed graph with reachability queries. Small enough for BFS on every mutation. */
export class RoutingGraph {
  #adjacency = new Map<AudioNodeId, Set<AudioNodeId>>();

  connect(from: AudioNodeId, to: AudioNodeId): void {
    let targets = this.#adjacency.get(from);
    if (!targets) {
      targets = new Set();
      this.#adjacency.set(from, targets);
    }
    targets.add(to);
  }

  disconnect(from: AudioNodeId, to?: AudioNodeId): void {
    if (to === undefined) {
      this.#adjacency.delete(from);
      return;
    }
    this.#adjacency.get(from)?.delete(to);
  }

  hasEdge(from: AudioNodeId, to: AudioNodeId): boolean {
    return this.#adjacency.get(from)?.has(to) ?? false;
  }

  /** Breadth-first reachability. Cycle-safe. */
  pathExists(from: AudioNodeId, to: AudioNodeId): boolean {
    if (from === to) return true;
    const seen = new Set<AudioNodeId>([from]);
    const queue: AudioNodeId[] = [from];

    while (queue.length > 0) {
      const current = queue.shift() as AudioNodeId;
      for (const next of this.#adjacency.get(current) ?? []) {
        if (next === to) return true;
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return false;
  }

  /** Every concrete path between two nodes; used by the verification panel. */
  tracePaths(from: AudioNodeId, to: AudioNodeId): AudioNodeId[][] {
    const results: AudioNodeId[][] = [];
    const walk = (node: AudioNodeId, trail: AudioNodeId[]): void => {
      if (node === to) {
        results.push([...trail, node]);
        return;
      }
      if (trail.includes(node)) return;
      for (const next of this.#adjacency.get(node) ?? []) {
        walk(next, [...trail, node]);
      }
    };
    walk(from, []);
    return results;
  }

  edges(): RoutingEdge[] {
    const out: RoutingEdge[] = [];
    for (const [from, targets] of this.#adjacency) {
      for (const to of targets) out.push({ from, to });
    }
    return out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  }

  clear(): void {
    this.#adjacency.clear();
  }
}

/**
 * The compliance rule set.
 *
 * Rules 1 and 2 are the ones that matter most: they are the difference between a
 * lawful AAC device and an unlawful wiretap.
 */
export const COMPLIANCE_RULES: readonly ComplianceRule[] = [
  {
    id: 'BIPA/mic-never-leaves-device',
    requirement:
      'The physical microphone must never reach the peer connection. Voiceprints are protected by the Biometric Information Privacy Act; signed-in GPT transcription is a separate, bounded completed-utterance request.',
    evaluate: (graph) => !graph.pathExists('microphone', 'peer'),
  },
  {
    id: 'RAUR-5/no-microphone-monitoring',
    requirement:
      'The physical microphone must not be mixed into the local speakers. The user hears their own room, not a delayed echo of themselves competing with their screen reader.',
    evaluate: (graph) => !graph.pathExists('microphone', 'speakers'),
  },
  {
    id: 'RAUR-5/microphone-feeds-local-inference',
    requirement:
      'The microphone must reach the on-device recogniser so instant dictation never depends on the network.',
    evaluate: (graph) => graph.pathExists('microphone', 'asr'),
  },
  {
    id: 'RAUR-5/synthetic-voice-is-the-only-transmission',
    requirement:
      'The synthesised AAC voice must be the sole signal transmitted to the remote peer.',
    evaluate: (graph) => graph.pathExists('tts', 'peer'),
  },
  {
    id: 'RAUR-5/user-monitors-own-output',
    requirement:
      'The user must hear what is being broadcast on their behalf through the local speakers.',
    evaluate: (graph) => graph.pathExists('tts', 'speakers'),
  },
  {
    id: 'Spec/contextual-harvesting',
    requirement:
      "The remote peer's audio must be transcribed locally to supply conversational context to the prediction agent.",
    evaluate: (graph) => graph.pathExists('remote', 'asr'),
  },
];

export function evaluateCompliance(graph: RoutingGraph): ComplianceResult[] {
  return COMPLIANCE_RULES.map((rule) => ({
    id: rule.id,
    requirement: rule.requirement,
    satisfied: rule.evaluate(graph),
  }));
}

/**
 * Throw if any *applicable* rule is violated.
 *
 * Applicability matters, and getting it wrong is not a theoretical concern: an
 * earlier version asserted the whole rule set on every microphone attach, which
 * meant `Spec/contextual-harvesting` - a rule about the remote peer's audio -
 * failed whenever there was no peer. Turning on the microphone threw unless a
 * call was already connected, so dictation, the primary input method, could
 * never be used alone.
 *
 * The prohibitions are unconditional and always evaluated. Only the rules that
 * assert a path *must exist* can be inapplicable, and only because the nodes
 * they describe do not exist yet.
 */
export function assertCompliance(
  graph: RoutingGraph,
  options: { callActive: boolean; micActive: boolean; emergencyOverride: boolean } = {
    callActive: true,
    micActive: true,
    emergencyOverride: false,
  },
): void {
  const violations = evaluateApplicableCompliance(graph, options).filter((result) => !result.satisfied);
  if (violations.length > 0) throw new RaurViolationError(violations);
}

/**
 * Rules that only hold once a call is live. Before a peer exists there is no
 * `peer` node and no `remote` node, so those rules are vacuously inapplicable.
 */
export function evaluateApplicableCompliance(
  graph: RoutingGraph,
  options: { callActive: boolean; micActive: boolean; emergencyOverride: boolean },
): ComplianceResult[] {
  return evaluateCompliance(graph).filter((result) => {
    if (!options.callActive && result.id.includes('peer')) return false;
    if (!options.callActive && result.id === 'Spec/contextual-harvesting') return false;
    if (!options.callActive && result.id.endsWith('synthetic-voice-is-the-only-transmission')) return false;
    if (!options.micActive && result.id.endsWith('microphone-feeds-local-inference')) return false;
    return true;
  });
}
