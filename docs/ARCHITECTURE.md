# Architecture

## The shape of it

One controller, `AacSession`, owns everything stateful: the audio graph, both
speech engines, the peer connection. React reads a store and calls methods on
it. Nothing stateful lives in a component.

That is deliberate. Audio contexts, WebAssembly handles and peer connections are
expensive to create and awkward to dispose. Put them in `useEffect` and a
re-render restarts an audio context or leaks a C++ object — the failure mode
that makes this class of application flaky in ways that are miserable to debug.

```
                    ┌──────────────────────────────┐
                    │        AacSession            │
                    │  (single owner of everything)│
                    └───┬──────────┬───────────┬───┘
                        │          │           │
            ┌───────────▼──┐  ┌────▼──────┐  ┌─▼──────────┐
            │ AacAudioGraph│  │ ASR / TTS │  │ PeerSession│
            │  2 contexts  │  │  workers  │  │  + RTT     │
            └───────┬──────┘  └────┬──────┘  └─────┬──────┘
                    │              │               │
                    └──────────────┴───────────────┘
                                   │
                            ┌──────▼──────┐
                            │    store    │──▶ React (useSyncExternalStore)
                            └──────┬──────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ WebMCP tools · prediction ladder│
                    └────────────────────────────────┘
```

## Two audio contexts

The single most consequential decision.

```
captureContext  (16 kHz)          playbackContext (native rate)
─────────────────────────         ────────────────────────────────
microphone                        AudioBufferSource (synthesis)
  └─ ChannelSplitter                └─ ttsBus (Gain)
       └─ capture worklet ─┐             ├─ localMonitor ─▶ destination
                           │             └─ MediaStreamDestination ─▶ peer
remote stream              │
  └─ capture worklet ──────┤        remote stream
                           │          └─ remoteMonitor ─▶ destination
                           ▼
                      ASR worker
```

The capture context contains **no** `destination` connection and **no**
`MediaStreamAudioDestinationNode`. There is no node in it that leads anywhere
off the device.

This turns "the microphone must never reach the peer" from a convention into
something close to a structural impossibility: the microphone's source node
belongs to a context that owns no outbound sink. A future refactor cannot
casually wire them together, because they are not in the same graph.

Capture worklets are also constructed with `numberOfOutputs: 0`. A worklet with
no outputs is still actively processed while it has an input, so the capture
path never needs a connection to `destination` to keep running.

### Why 16 kHz

Requesting `new AudioContext({ sampleRate: 16000 })` lets the browser's own
resampler do the work, which is better than anything reasonable to hand-write.
Where a platform refuses (Safari has historically pinned to 44.1/48 kHz), the
worklet resamples instead — a 33-tap Hamming-windowed sinc at the target Nyquist
followed by linear interpolation, with filter state carried across chunk
boundaries. Without that filter, content above 8 kHz folds into the speech band
and raises word error rate in a way that is very hard to attribute later.
`Diagnostics` shows which path is in use.

## The capture path

```
128-frame render quantum
      │  (audio rendering thread)
      ├─ resample to 16 kHz, filter state carried across chunks
      ├─ accumulate into 1024-sample frames
      ├─ compute RMS and peak
      └─ postMessage(frame, [frame.buffer])    ← transferred, not copied
             │  (main thread: relay only, no DSP)
             ├─ VAD state machine over the RMS
             ├─ below threshold → hold in a 3-frame pre-roll ring
             └─ above threshold → flush pre-roll, then stream to the worker
                    │  (worker thread)
                    └─ acceptWaveform → isReady → decode → getResult → isEndpoint
```

**The pre-roll matters.** The VAD needs two frames of evidence before it
commits, and without a pre-roll those frames are discarded — which reliably
decapitates the first consonant of every utterance.

**The VAD's noise floor adapts asymmetrically**: quickly downward, slowly
upward. A quiet room is tracked promptly, while speech itself cannot drag the
floor up and deafen the detector mid-sentence. Hysteresis between activation and
release thresholds stops the gate chattering, and a hangover window rides out
the near-silence of a stop consonant instead of chopping the utterance in two.

## Speech engines

`AsrProvider` and `TtsProvider` are interfaces. Three ASR implementations
(Sherpa-ONNX, platform, null) and two TTS. The session picks the best available
and falls back with an explanation rather than an error.

The Sherpa workers are **classic** workers, not modules. The Emscripten glue
that ships with Sherpa-ONNX is a non-module script expecting a pre-existing
global `Module` — exactly what `importScripts` provides. Coaxing it through a
bundler costs more than it buys. `Module.locateFile` points the glue at its
sibling `.wasm` and `.data`.

Both bundle shapes are supported: streaming (Zipformer transducer, partial
hypotheses as you speak) and offline (SenseVoice/Whisper class, decoded per
VAD-delimited utterance — slower to first word, better punctuation).

`routable` on `TtsProvider` is load-bearing. `speechSynthesis` renders to the OS
mixer, outside any graph we can reach: there is no buffer to capture and so no
way to put that voice on a WebRTC track. It works for in-person use and not at
all for calls, and the interface says so instead of failing silently.

## WebRTC

Perfect negotiation, with politeness decided by comparing peer ids — stable, and
needs no extra round trip. The data channel is created **before** the first
offer so Real-Time Text is available the instant the call connects.

ICE candidates gathered before the remote peer is known are **buffered**, not
dropped. Gathering starts when the connection is created and, with a pre-warmed
candidate pool, often finishes before the other person has joined. Discarding
those candidates leaves the connection nothing to try; it fails after the ICE
timeout and presents as an intermittent "calls sometimes don't connect".

Real-Time Text holds one stable id per composed message. Composing updates
revise that message in place; sending finalises it; clearing retracts it with an
empty final update.

## Prediction ladder

1. **External WebMCP agent** — pushes suggestions *in* by calling
   `predict-conversational-phrase`. Never awaited, because an agent's timing is
   not ours to control.
2. **On-device language model** — Chrome's Prompt API where present. Better
   language, and still no network egress. Proves itself with a canary prompt
   before it is trusted, because a browser shipping a stub that echoes its input
   is not hypothetical.
3. **Rule engine** — deterministic intent matching and a shorthand expander over
   a small AAC vocabulary. Microseconds, no dependencies, cannot fail.

Tiers 2 and 3 write suggestions to the store directly and label them with their
real source, so the interface never claims an agent suggested something it did
not. The agent-facing tool is exercised by the Diagnostics simulator and by the
test suite, which is what makes it possible to confirm the agent protocol on a
browser with no WebMCP implementation at all.

## WebMCP lifecycle

Registration is imperative and global, so teardown is the part that matters: a
component that unmounts without unregistering leaves a tool whose handler closes
over dead state. Everything hangs off one `AbortController`.

The specification has moved — `document.modelContext` with `call`/`parameters`,
toward `navigator.modelContext` with `execute`/`inputSchema`. The integration
supplies both key pairs and looks for both surfaces, then degrades to a no-op.

Tools are also mirrored into a local `ToolRegistry`, which is what lets the
verification panel execute the agent protocol on browsers with no WebMCP at all.

## State

A ~40-line store over `useSyncExternalStore`. Snapshots are memoised on state
identity so selectors returning fresh arrays do not cause re-render loops.

Turns are keyed by id and updated in place. Appending every interim recognition
result would make the transcript unreadable — and for a screen-reader user,
unusable.

## Origin server

`server.js` has no framework. It serves the build with isolation headers,
negotiates pre-compressed siblings, applies the caching policy, and hosts the
signalling WebSocket.

ETags identify the *representation*, not the file: a client that cached the
Brotli body and later asks without `Accept-Encoding: br` would otherwise receive
a 304 for a body it cannot decode.

`.onnx` and `.data` are deliberately never compressed — dense float matrices do
not shrink, and compressing them burns CPU at the edge and delays first audio.
They are served uncompressed with `immutable` caching instead.
