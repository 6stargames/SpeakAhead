export interface IceProbeResult {
  readonly stunReachable: boolean;
  readonly turnReachable: boolean;
  readonly turnConfigured: boolean;
  readonly candidateTypes: readonly string[];
  readonly elapsedMs: number;
  readonly detail: string;
}

/** `candidate:... typ host|srflx|prflx|relay ...` */
function candidateType(candidate: string): string | null {
  const match = /\btyp\s+(\w+)/.exec(candidate);
  return match?.[1] ?? null;
}

export function hasTurnServer(iceServers: readonly RTCIceServer[]): boolean {
  return iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => typeof url === 'string' && /^turns?:/i.test(url));
  });
}

/**
 * Gather ICE candidates against the configured servers and report what came
 * back.
 *
 * Worth doing before a call rather than during one. A missing `relay` candidate
 * means the TURN credentials are wrong or the relay is unreachable - and the
 * symptom of finding that out mid-call is a call that connects, shows every
 * sign of working, and carries no audio. In a hospital or a school district,
 * behind the symmetric NAT this check exists for, that is the common case.
 */
export async function probeIceServers(
  iceServers: readonly RTCIceServer[],
  timeoutMs = 8000,
): Promise<IceProbeResult> {
  const started = Date.now();
  const types = new Set<string>();
  const turnConfigured = hasTurnServer(iceServers);

  if (typeof RTCPeerConnection === 'undefined') {
    return {
      stunReachable: false,
      turnReachable: false,
      turnConfigured,
      candidateTypes: [],
      elapsedMs: 0,
      detail: 'WebRTC is not available in this environment.',
    };
  }

  const connection = new RTCPeerConnection({
    iceServers: iceServers as RTCIceServer[],
    iceCandidatePoolSize: 0,
  });

  try {
    // A data channel is enough to trigger gathering without touching hardware.
    connection.createDataChannel('ice-probe');

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);

      connection.onicecandidate = (event) => {
        if (!event.candidate) {
          clearTimeout(timer);
          resolve();
          return;
        }
        const type = candidateType(event.candidate.candidate);
        if (type) types.add(type);
        // Once a relay candidate appears the question is answered; stop early.
        if (type === 'relay') {
          clearTimeout(timer);
          resolve();
        }
      };

      void connection
        .createOffer()
        .then((offer) => connection.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timer);
          resolve();
        });
    });

    const stunReachable = types.has('srflx') || types.has('relay');
    const turnReachable = types.has('relay');

    let detail: string;
    if (turnReachable) {
      detail = 'Relay candidate obtained - calls will connect through restrictive firewalls.';
    } else if (!turnConfigured) {
      detail =
        'No TURN server configured. Calls will fail behind symmetric NAT, which is the norm on hospital and school networks.';
    } else if (stunReachable) {
      detail = 'TURN is configured but returned no relay candidate. Check the credentials and that UDP/3478 is open.';
    } else {
      detail = 'No server-reflexive candidates. UDP is likely blocked outright on this network.';
    }

    return {
      stunReachable,
      turnReachable,
      turnConfigured,
      candidateTypes: [...types],
      elapsedMs: Date.now() - started,
      detail,
    };
  } finally {
    connection.onicecandidate = null;
    connection.close();
  }
}
