# Blueprint 2 — Implementation Plan

Derived from *"Comprehensive Engineering and Implementation Specification for
Context-Aware AAC via WebRTC Edge AI."* Every mandate in that document is mapped
below to a concrete deliverable, plus a statement of how it is verified and what
(if anything) must be provisioned outside this repository.

## Guiding constraints

| Constraint | Source | Consequence for the code |
| --- | --- | --- |
| Voice data must never leave the device | Illinois BIPA | No audio buffer may reach `fetch`/`XHR`/`WebSocket`/`RTCPeerConnection` except the *synthesised* TTS track. Enforced by a CI egress audit and by the audio graph's invariant assertions. |
| Sub-millisecond routing precision | Spec §Audio Routing | All capture happens in an `AudioWorklet` on the render thread; inference happens in Workers. The main thread never touches PCM. |
| Cross-origin isolation | Spec §Threading | `COOP: same-origin` + `COEP: require-corp` served in dev (Vite), preview, and production (`server.js`). Unlocks `SharedArrayBuffer` → multi-threaded ONNX. |
| W3C RAUR compliance | Spec §RAUR | Audio topology is modelled declaratively so "microphone must not reach peer" is a testable graph property, not a code-review promise. |
| Agentic context | Spec §WebMCP | `document.modelContext` / `navigator.modelContext` tools bound to `AbortController`, degrading to no-op. |

## Phase 1 — Regulatory & environmental foundations

1. **Toolchain**: Vite + React 19 + TypeScript (strict). Vite is mandated over
   Webpack for native WASM asset handling and ESM resolution.
2. **Cross-origin isolation**: headers applied in three places (dev server,
   preview server, production origin). `COEP` mode is env-overridable to
   `credentialless` for teams serving models from a third-party CDN.
3. **Isolation self-test**: the app boots a `CrossOriginIsolationProbe` that
   reports `crossOriginIsolated`, `typeof SharedArrayBuffer`, and the achievable
   thread count, surfaced in the Verification panel — the spec's manual console
   check, automated.
4. **Regional signalling**: a Node + WebSocket signalling server. Shipped twice —
   mounted on the app origin at `/signal` for single-container deploys, and as a
   standalone package under `signaling/` for the mandated Midwest regional
   deployment (us-east-2 / us-central1), with an optional Redis fan-out adapter.
5. **TURN**: ICE configuration accepts STUN + TURN from env, with a
   `checkTurnReachability()` probe that gathers a `relay` candidate to prove the
   relay path works before a call is attempted.

## Phase 2 — Edge AI speech processing (Sherpa-ONNX)

1. **Provider abstraction** (`src/speech/types.ts`): `AsrProvider` / `TtsProvider`
   interfaces so the engine is swappable and testable.
2. **ASR**: `SherpaOnnxAsrProvider` spawns a *classic* Worker
   (`public/workers/sherpa-asr-worker.js`) that `importScripts` the Emscripten
   glue, instantiates the streaming Zipformer recogniser, and runs the official
   `acceptWaveform → isReady → decode → getResult → isEndpoint → reset` loop.
3. **Two-pass refinement**: an optional offline pass (SenseVoice/Whisper class
   model) re-decodes each finalised utterance to restore punctuation, exactly as
   the spec's two-pass architecture describes. Wired as
   `AsrProvider.refine(utterance)`; skipped when no offline model is configured.
4. **VAD**: Silero via the Sherpa VAD bundle when available; otherwise a
   self-contained adaptive-energy VAD (`src/speech/vad.ts`) with noise-floor
   tracking and hangover frames. The VAD gates the Zipformer so silence never
   reaches the neural network.
5. **Audio pipeline**: `getUserMedia` → `MediaStreamAudioSourceNode` →
   `ChannelSplitterNode` → `AudioWorkletNode`. The worklet accumulates 128-frame
   quanta, resamples to 16 kHz with an anti-aliased decimator, computes RMS, and
   transfers `Float32Array` chunks over a `MessagePort`.
6. **Memory lifecycle**: `useSherpaASR` / `useSherpaTTS` own the WASM handles and
   free the C++ objects on unmount. Every provider exposes `dispose()` and a
   `heapBytes()` reading so leak-checking is a UI readout, not a manual snapshot.
7. **TTS**: `SherpaOnnxTtsProvider` (Piper/VITS/Kokoro) synthesises to a
   `Float32Array`, which becomes an `AudioBuffer` on an `AudioBufferSourceNode`
   feeding the graph's TTS bus. A `SpeechSynthesisTtsProvider` fallback exists
   but is explicitly marked *not routable to the peer* (the OS mixes it outside
   the Web Audio graph) and is consent-gated.

## Phase 3 — WebRTC and RAUR-compliant routing

1. **Declarative routing matrix** (`src/audio/AudioGraph.ts`): every edge is
   registered in an adjacency model *and* applied to Web Audio. This makes the
   spec's four-row routing table machine-checkable.
2. **Enforced invariants** (`assertRaurInvariants()`), run on every mutation:
   - no path from `microphone` to `peer`
   - no path from `microphone` to `speakers` (no local echo of the user's body)
   - a path from `tts` to both `speakers` and `peer`
   - a path from `remote` to both `speakers` and `asr`
3. **Peer session** (`src/webrtc/PeerSession.ts`): perfect-negotiation
   `RTCPeerConnection`, `RTCDataChannel('aac-rtt')` created *before* the offer,
   `addTrack` given only the `MediaStreamAudioDestinationNode` track.
4. **Real-Time Text**: an RTT protocol over the data channel carrying incremental
   composition and finalised turns, rendered with distinct incoming/outgoing
   styling (RAUR Need 13).
5. **Emergency override** (RAUR Need 11): dynamically severs remote audio from
   the destination and drives TTS gain to unity ceiling; latched, announced to
   the peer over the data channel, and reflected in an `aria-live` region.

## Phase 4 — Context-aware agent integration (WebMCP)

1. **`useWebMCPTool`**: defensive detection of `document.modelContext` and
   `navigator.modelContext`, `AbortController`-bound registration, no-op
   degradation, and support for both `signal`-based and returned-unregister
   teardown shapes.
2. **Mandated tools**: `predict-conversational-phrase` (3 suggestions → quick
   reply chips) and `expand-semantic-shorthand` (shorthand → full sentence into
   the composition buffer).
3. **Context tools**: `get-conversation-context` and `get-composition-state` give
   the agent the rolling ten-turn transcript the spec's feedback loop requires.
4. **Safety decision**: `speak-text` *stages* agent-authored speech for one-tap
   user confirmation rather than speaking autonomously. An AAC device must not
   put words in its user's mouth without consent; the direct-speak path exists
   but is opt-in in Settings. This is a deliberate deviation, documented in
   `docs/RAUR.md`.
5. **Prediction fallback ladder** so the feature works with no agent attached:
   WebMCP agent → Chrome on-device Prompt API (`LanguageModel`) → deterministic
   n-gram/intent heuristic over a built-in AAC corpus. Tiers 2 and 3 are fully
   offline and BIPA-safe.
6. **Agent simulator**: a Verification-panel harness that invokes the registered
   tools directly, so the spec's WebMCP confirmation protocol can be executed on
   browsers without the flag.

## Phase 5 — Deployment, CI/CD, operations

1. **Origin server** (`server.js`): serves `dist/`, applies COOP/COEP/CORP,
   negotiates pre-compressed `.br`/`.gz`, sets `immutable` caching for hashed
   assets and models, `no-cache` for HTML, exposes `/healthz`, and mounts the
   signalling WebSocket.
2. **Compression policy** (`scripts/precompress.mjs`): Brotli + gzip for
   `.wasm/.js/.css/.html/.json`; `.onnx`/`.data` deliberately left uncompressed
   with immutable headers, per the spec's CDN mandate.
3. **Offline independence**: Workbox via `vite-plugin-pwa` precaches the shell
   and runtime-caches model weights `CacheFirst` with range-request support.
4. **CI** (`.github/workflows/ci.yml`): typecheck → unit tests → egress audit →
   build.
5. **BIPA egress audit** (`scripts/audit-egress.mjs`): fails the build if raw
   audio types appear in a network-sending call site.

## Explicitly out of repository scope

These require infrastructure or hardware that cannot be provisioned from source
control. Each has complete configuration and documentation committed.

| Item | Why | Where it is specified |
| --- | --- | --- |
| Sherpa-ONNX model weights (hundreds of MB) | Cannot be committed to git | `scripts/fetch-models.mjs`, `docs/MODELS.md` |
| Coturn TURN server | Requires a host with a public IP | `docs/DEPLOYMENT.md` (full `turnserver.conf`) |
| Regional signalling deployment | Requires a cloud account | `signaling/` + `signaling/Dockerfile` |
| Two-device acoustic segregation test | Requires two machines in two rooms | `docs/VERIFICATION.md` §3 |
| WebMCP agent end-to-end | Requires Chrome with the flag / an agent host | Simulator in the Verification panel |
