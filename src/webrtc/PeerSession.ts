import { Emitter } from '@/lib/events';
import { createId } from '@/lib/id';
import { createSignalingClient, type SignalingTransport } from './createSignalingClient';
import type { SignalingStatus } from './SignalingClient';
import {
  isDataChannelMessage,
  RTT_CHANNEL_LABEL,
  type DataChannelMessage,
  type PeerHello,
  type RttMessage,
  type SignalPayload,
} from './protocol';

export type CallState = 'idle' | 'joining' | 'waiting' | 'connecting' | 'connected' | 'failed' | 'closed';

interface PeerSessionEvents extends Record<string, unknown> {
  state: CallState;
  signaling: SignalingStatus;
  track: MediaStream;
  message: DataChannelMessage;
  'rtt-channel': boolean;
  stats: PeerStats;
  error: Error;
}

export interface PeerStats {
  readonly roundTripMs: number | null;
  readonly outboundKbps: number | null;
  readonly packetsLost: number | null;
  readonly candidatePair: string | null;
}

export interface PeerSessionOptions {
  readonly signalingUrl: string;
  readonly iceServers: readonly RTCIceServer[];
  readonly displayName: string;
}

/**
 * One WebRTC call.
 *
 * Uses the perfect-negotiation pattern so that either side may (re)negotiate at
 * any time without the two ends deadlocking on simultaneous offers. Politeness
 * is decided by comparing peer ids, which is stable and needs no extra
 * round-trip.
 *
 * The only track ever added is the synthesised-voice track produced by the
 * audio graph's MediaStreamAudioDestinationNode. `addTrack` is deliberately not
 * exposed as a general-purpose method — see `setOutboundTrack`.
 */
export class PeerSession {
  readonly events = new Emitter<PeerSessionEvents>();

  readonly peerId = createId('peer');

  #options: PeerSessionOptions;
  #signaling: SignalingTransport;
  #connection: RTCPeerConnection | null = null;
  #channel: RTCDataChannel | null = null;
  #remotePeerId: string | null = null;
  #outboundTrack: MediaStreamTrack | null = null;
  #outboundStream: MediaStream | null = null;
  #sender: RTCRtpSender | null = null;

  /**
   * Candidates gathered before the remote peer is known.
   *
   * Gathering starts the moment the connection is created — and with a
   * pre-warmed candidate pool, often finishes before the other person has
   * joined the room. Dropping those candidates leaves the connection with
   * nothing to try and it fails after the ICE timeout, which presents as an
   * intermittent "the call just doesn't connect". They are buffered and flushed
   * as soon as there is somewhere to send them.
   */
  #pendingCandidates: (RTCIceCandidateInit | null)[] = [];
  /**
   * Candidates that arrived before the remote description did.
   *
   * Long-polling delivers signalling in batches, so the other side's ICE
   * candidates can outrun their offer. Applying one then throws "the remote
   * description was null" and the call dies on a race that ordering was
   * never guaranteed to win. They wait here until the description lands.
   */
  #inboundCandidates: RTCIceCandidateInit[] = [];

  #polite = false;
  #makingOffer = false;
  #ignoreOffer = false;
  #state: CallState = 'idle';
  #rttSequence = 0;
  #statsTimer: ReturnType<typeof setInterval> | null = null;
  #lastBytesSent = 0;
  #lastStatsAt = 0;

  constructor(options: PeerSessionOptions) {
    this.#options = options;
    this.#signaling = createSignalingClient(options.signalingUrl);

    this.#signaling.events.on('status', (status) => this.events.emit('signaling', status));
    this.#signaling.events.on('error', (error) => this.events.emit('error', error));
    this.#signaling.events.on('joined', ({ peers }) => {
      const other = peers.find((id) => id !== this.peerId);
      if (other) {
        this.#adoptRemotePeer(other);
        void this.#negotiate();
      } else {
        this.#setState('waiting');
      }
    });
    this.#signaling.events.on('peer-joined', ({ peerId }) => {
      if (this.#remotePeerId) return;
      this.#adoptRemotePeer(peerId);
    });
    this.#signaling.events.on('peer-left', ({ peerId }) => {
      if (peerId !== this.#remotePeerId) return;
      this.#remotePeerId = null;
      this.#setState('waiting');
    });
    this.#signaling.events.on('signal', ({ from, payload }) => {
      void this.#handleSignal(from, payload);
    });
  }

  get state(): CallState {
    return this.#state;
  }

  get rttReady(): boolean {
    return this.#channel?.readyState === 'open';
  }

  /**
   * The synthesised-voice track. Setting it before joining means the very first
   * offer already carries the correct media, so no renegotiation is needed to
   * start speaking.
   */
  setOutboundTrack(track: MediaStreamTrack | null, stream: MediaStream | null): void {
    this.#outboundTrack = track;
    this.#outboundStream = stream;

    if (!this.#connection || !track || !stream) return;
    if (this.#sender) {
      void this.#sender.replaceTrack(track);
    } else {
      this.#sender = this.#connection.addTrack(track, stream);
    }
  }

  async join(room: string): Promise<void> {
    this.#setState('joining');
    this.#createConnection();
    await this.#signaling.connect(room, this.peerId);
  }

  hangUp(): void {
    this.#stopStats();
    this.#channel?.close();
    this.#channel = null;
    this.#connection?.close();
    this.#connection = null;
    this.#inboundCandidates = [];
    this.#sender = null;
    this.#remotePeerId = null;
    this.#pendingCandidates = [];
    this.#signaling.close();
    this.#setState('closed');
  }

  // -------------------------------------------------------------------------
  // Real-Time Text
  // -------------------------------------------------------------------------

  sendRtt(text: string, final: boolean, id?: string): RttMessage | null {
    if (this.#channel?.readyState !== 'open') return null;
    this.#rttSequence += 1;
    const message: RttMessage = {
      t: 'rtt',
      id: id ?? createId('rtt'),
      text,
      final,
      seq: this.#rttSequence,
      sentAt: Date.now(),
    };
    this.#channel.send(JSON.stringify(message));
    return message;
  }

  sendState(emergencyOverride: boolean, composing: boolean): void {
    if (this.#channel?.readyState !== 'open') return;
    this.#channel.send(JSON.stringify({ t: 'state', emergencyOverride, composing }));
  }

  // -------------------------------------------------------------------------

  #createConnection(): void {
    const connection = new RTCPeerConnection({
      iceServers: this.#options.iceServers as RTCIceServer[],
      // Pre-gathering shortens call setup, which matters when the person
      // placing the call may be in distress.
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    this.#connection = connection;

    // The spec is explicit that the data channel must exist before the offer,
    // so RTT is available the instant the call connects rather than after a
    // second negotiation round.
    const channel = connection.createDataChannel(RTT_CHANNEL_LABEL, {
      ordered: true,
      negotiated: false,
    });
    this.#bindChannel(channel);

    if (this.#outboundTrack && this.#outboundStream) {
      this.#sender = connection.addTrack(this.#outboundTrack, this.#outboundStream);
    }

    connection.ondatachannel = (event) => {
      if (event.channel.label === RTT_CHANNEL_LABEL) this.#bindChannel(event.channel);
    };

    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.events.emit('track', stream);
    };

    connection.onicecandidate = (event) => {
      const candidate = event.candidate ? event.candidate.toJSON() : null;
      if (!this.#remotePeerId) {
        this.#pendingCandidates.push(candidate);
        return;
      }
      this.#signaling.signal(this.#remotePeerId, { kind: 'candidate', candidate });
    };

    connection.onnegotiationneeded = () => {
      void this.#negotiate();
    };

    connection.onconnectionstatechange = () => {
      switch (connection.connectionState) {
        case 'connected':
          this.#setState('connected');
          this.#startStats();
          break;
        case 'failed':
          this.#setState('failed');
          this.events.emit(
            'error',
            new Error(
              'The peer connection failed. Without a reachable TURN relay this is expected on networks that block direct UDP.',
            ),
          );
          break;
        case 'disconnected':
          this.#setState('connecting');
          break;
        case 'closed':
          this.#setState('closed');
          break;
        default:
          break;
      }
    };

    connection.oniceconnectionstatechange = () => {
      if (connection.iceConnectionState === 'failed') connection.restartIce();
    };
  }

  /** Record the peer, decide politeness, and release any buffered candidates. */
  #adoptRemotePeer(peerId: string): void {
    this.#remotePeerId = peerId;
    // Deterministic tie-break: the lexicographically smaller id is polite.
    this.#polite = this.peerId < peerId;
    this.#setState('connecting');
    this.#flushPendingCandidates();
  }

  #flushPendingCandidates(): void {
    if (!this.#remotePeerId || this.#pendingCandidates.length === 0) return;
    const queued = this.#pendingCandidates;
    this.#pendingCandidates = [];
    for (const candidate of queued) {
      this.#signaling.signal(this.#remotePeerId, { kind: 'candidate', candidate });
    }
  }

  #bindChannel(channel: RTCDataChannel): void {
    this.#channel = channel;

    channel.onopen = () => {
      this.events.emit('rtt-channel', true);
      const hello: PeerHello = {
        t: 'hello',
        displayName: this.#options.displayName,
        capabilities: { synthesisRoutable: this.#outboundTrack !== null, recognitionOffline: true },
      };
      channel.send(JSON.stringify(hello));
    };

    channel.onclose = () => this.events.emit('rtt-channel', false);

    channel.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (isDataChannelMessage(parsed)) this.events.emit('message', parsed);
    };
  }

  async #negotiate(): Promise<void> {
    const connection = this.#connection;
    if (!connection || !this.#remotePeerId) return;

    try {
      this.#makingOffer = true;
      await connection.setLocalDescription();
      if (connection.localDescription) {
        this.#signaling.signal(this.#remotePeerId, {
          kind: 'description',
          description: connection.localDescription.toJSON(),
        });
      }
    } catch (error) {
      this.events.emit('error', error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#makingOffer = false;
    }
  }

  async #handleSignal(from: string, payload: SignalPayload): Promise<void> {
    const connection = this.#connection;
    if (!connection) return;

    if (!this.#remotePeerId) this.#adoptRemotePeer(from);

    try {
      if (payload.kind === 'description') {
        const description = payload.description;
        const offerCollision =
          description.type === 'offer' && (this.#makingOffer || connection.signalingState !== 'stable');

        // Perfect negotiation: the impolite peer ignores a colliding offer and
        // lets its own proceed; the polite peer rolls back and accepts.
        this.#ignoreOffer = !this.#polite && offerCollision;
        if (this.#ignoreOffer) return;

        await connection.setRemoteDescription(description);

        // Release any candidates that outran this description.
        const waiting = this.#inboundCandidates;
        this.#inboundCandidates = [];
        for (const candidate of waiting) {
          try {
            await connection.addIceCandidate(candidate);
          } catch (error) {
            if (!this.#ignoreOffer) throw error;
          }
        }

        if (description.type === 'offer') {
          await connection.setLocalDescription();
          if (connection.localDescription) {
            this.#signaling.signal(from, {
              kind: 'description',
              description: connection.localDescription.toJSON(),
            });
          }
        }
      } else if (payload.candidate) {
        if (!connection.remoteDescription) {
          // Outran the offer; hold it until the description arrives.
          this.#inboundCandidates.push(payload.candidate);
          return;
        }
        try {
          await connection.addIceCandidate(payload.candidate);
        } catch (error) {
          // A candidate arriving for an offer we deliberately dropped is normal.
          if (!this.#ignoreOffer) throw error;
        }
      }
    } catch (error) {
      this.events.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  #startStats(): void {
    this.#stopStats();
    this.#lastStatsAt = Date.now();
    this.#statsTimer = setInterval(() => void this.#collectStats(), 2000);
  }

  #stopStats(): void {
    if (this.#statsTimer) {
      clearInterval(this.#statsTimer);
      this.#statsTimer = null;
    }
  }

  async #collectStats(): Promise<void> {
    const connection = this.#connection;
    if (!connection) return;

    try {
      const report = await connection.getStats();
      let roundTripMs: number | null = null;
      let packetsLost: number | null = null;
      let candidatePair: string | null = null;
      let bytesSent = 0;

      report.forEach((entry) => {
        const stat = entry as Record<string, unknown>;
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
          if (typeof stat.currentRoundTripTime === 'number') {
            roundTripMs = Math.round(stat.currentRoundTripTime * 1000);
          }
          candidatePair = `${String(stat.localCandidateId)} → ${String(stat.remoteCandidateId)}`;
        }
        if (stat.type === 'outbound-rtp' && typeof stat.bytesSent === 'number') {
          bytesSent += stat.bytesSent;
        }
        if (stat.type === 'inbound-rtp' && typeof stat.packetsLost === 'number') {
          packetsLost = stat.packetsLost;
        }
      });

      const now = Date.now();
      const elapsedSeconds = Math.max(0.001, (now - this.#lastStatsAt) / 1000);
      const outboundKbps =
        this.#lastBytesSent > 0 ? ((bytesSent - this.#lastBytesSent) * 8) / 1000 / elapsedSeconds : null;

      this.#lastBytesSent = bytesSent;
      this.#lastStatsAt = now;

      this.events.emit('stats', {
        roundTripMs,
        outboundKbps: outboundKbps === null ? null : Math.max(0, Math.round(outboundKbps)),
        packetsLost,
        candidatePair,
      });
    } catch {
      /* Stats are diagnostic; never let them break a call. */
    }
  }

  #setState(state: CallState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.events.emit('state', state);
  }
}
