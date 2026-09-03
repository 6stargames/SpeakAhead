# Context-Aware AAC

An augmentative and alternative communication device that runs in a browser.
Speech recognition and synthesis start on the device; WebRTC carries the
synthesised voice and real-time text to a conversation partner; and an AI agent
can propose what to say next through [WebMCP](https://developer.chrome.com/docs/ai/webmcp/imperative-api).

## Demo

- [Watch the narrated demo](https://www.youtube.com/watch?v=iHD89XHAULU)
- [Try the live application](https://speakahead.net)

## How SpeakAhead uses WebMCP

SpeakAhead registers four imperative WebMCP tools from
[`src/webmcp/tools.ts`](src/webmcp/tools.ts):

- `get-conversation-context` gives an agent the recent conversation and current
  composition so its help is grounded in what was actually said.
- `set-contextual-vocabulary` prepares six useful words and four short replies
  for the user's Words and Phrases boards.
- `set-symbol-theme` changes the device's button-picture style after an explicit
  user request.
- `set-chatgpt-voice` selects the OpenAI voice used after the user taps **Speak**.

The tools register through `document.modelContext`, retain compatibility with
the earlier `navigator.modelContext` API, and unregister cleanly when their React
components unmount. Agent suggestions are staged in the interface; they never
speak automatically or bypass the user's final choice.

**Rebuilding this, or picking it up cold?** Start with
[docs/PROJECT_LOG.md](docs/PROJECT_LOG.md) — the build order, the decisions that
are not obvious, and every trap that cost real time.

Implementation of *"Blueprint 2: Comprehensive Engineering and Implementation
Specification for Context-Aware AAC via WebRTC Edge AI."* The plan mapping every
mandate in that document to a deliverable is in
[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Why it is built this way

**Recognition is local-first.** Sherpa-ONNX produces immediate text without a
network dependency. When a user signs in with ChatGPT, each completed, bounded
utterance is also sent to OpenAI for an optional `gpt-transcribe` accuracy pass;
it is never a continuous microphone stream, and a failure leaves the ONNX text
intact. The microphone is still structurally unable to reach a WebRTC peer.
Deployers must provide the notice, consent, and retention policy appropriate to
their jurisdiction before enabling cloud transcription. See
[docs/BIPA.md](docs/BIPA.md).

**The audio topology is a first-class object.** A conventional WebRTC app wires
the microphone straight to the peer connection. For an AAC user that is actively
harmful: it transmits their screen reader, their room, and involuntary
vocalisations. The routing here is modelled declaratively, and rules like *"no
path exists from the microphone to the peer"* are evaluated as graph reachability
on every mutation. See [docs/RAUR.md](docs/RAUR.md).

**Nothing critical depends on a network or an agent.** With the network severed
and no agent attached, the phrase board, composition, expansion, prediction and
synthesis all still work.

## Quick start

```bash
npm install
npm run dev
```

Then, to enable on-device dictation and the neural voice (~260 MB):

```bash
npm run fetch:models
```

The app runs without them — see [docs/MODELS.md](docs/MODELS.md).

## Production

```bash
npm run build
npm start
```

`server.js` serves the build with the Cross-Origin Isolation headers the speech
engines need, negotiates pre-compressed assets, and hosts the signalling
WebSocket at `/signal`. Deployment guidance, including TURN and regional
signalling, is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Verification

```bash
npm run verify   # typecheck + tests + BIPA egress audit
```

The specification's confirmation protocols are written as manual rituals. Those
that can be checked mechanically are: over 400 automated tests, a static egress audit, and
a live **Diagnostics** panel in the app showing compliance rules, the routing
matrix and the environment. What still needs hands and two rooms is listed in
[docs/VERIFICATION.md](docs/VERIFICATION.md).

## How it fits together

```
microphone ──▶ ChannelSplitter ──▶ AudioWorklet ──▶ ASR worker (WASM)
                                     16 kHz, VAD-gated        │
                                     signed-in, finished turn ├──▶ GPT transcription
                                                              ▼
                                                        instant transcript
                                                              │
composition ◀── WebMCP tools ◀── prediction ladder ◀──────────┘
     │              ▲
     │              └── external agent · on-device model · rule engine
     ▼
TTS worker (WASM) ──▶ AudioBufferSource ──▶ TTS bus ─┬─▶ speakers
                                                     └─▶ MediaStreamDestination ──▶ RTCPeerConnection

remote peer audio ──┬──▶ speakers
                    └──▶ AudioWorklet ──▶ ASR worker   (conversational context)
```

The microphone and the peer connection live in **separate AudioContexts**. The
capture context owns no outbound sink, so the separation is structural rather
than a convention a refactor could quietly break.

Deeper detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Layout

| Path | What it is |
| --- | --- |
| `src/audio/` | Routing model, compliance rules, the Web Audio graph |
| `src/speech/` | ASR/TTS provider interfaces, VAD, punctuation restoration |
| `src/webrtc/` | Signalling client, perfect-negotiation peer session, ICE probe |
| `src/webmcp/` | Tool definitions, registry, `useWebMCPTool` |
| `src/prediction/` | The three-tier prediction ladder |
| `src/session/` | `AacSession` — the single controller everything hangs off |
| `public/workers/` | Sherpa-ONNX WASM workers (classic, `importScripts`) |
| `public/worklets/` | Capture worklet and the resampler it shares with the tests |
| `signaling/` | Signalling hub; runs bundled or standalone |
| `scripts/` | Model fetcher, pre-compression, BIPA egress audit, icons |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with isolation headers |
| `npm run build` | Typecheck, build, pre-compress |
| `npm start` | Serve the build and the signalling socket |
| `npm test` | Unit tests |
| `npm run verify` | Typecheck + tests + egress audit |
| `npm run fetch:models` | Download the Sherpa-ONNX bundles |
| `npm run upload:models` | Upload them to a Cloud Storage bucket (alternative host) |
| `npm run setup:gcp` | Service-account and Secret Manager wiring (idempotent) |
| `npm run audit:egress` | Flag every unreviewed audio path to the network |

## Known limits

- **Platform-voice fallback cannot be transmitted.** `speechSynthesis` renders
  to the OS mixer, outside any graph we can reach, so with no on-device voice
  installed a remote partner sees your text but hears nothing. The interface
  says so rather than failing quietly.
- **The bundled signalling server is single-instance.** Room membership is in
  process memory. See the comment in `apphosting.yaml`.
- **WebMCP is experimental.** The integration accepts both the
  `document.modelContext` and `navigator.modelContext` dialects and degrades to
  a no-op elsewhere.

## License

SpeakAhead is available under the [MIT License](LICENSE).
