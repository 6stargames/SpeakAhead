# Project log and rebuild guide

Everything needed to rebuild this system from nothing, plus every trap that cost
real time the first time round. Written for whoever picks this up next —
possibly us, months from now, with none of the context still in our heads.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for how the code is shaped and
[DEPLOYMENT.md](DEPLOYMENT.md) for the operational detail. This file is the
narrative: what was decided, what broke, and what we would do differently.

---

## 1. Where things stand

| | |
| --- | --- |
| **Live app** | https://speakahead.net |
| **Repository** | https://github.com/6stargames/SpeakAhead |
| **Model host** | https://webmcp-aac-models.web.app (Firebase Hosting) |
| **GCP project** | `vpx4900` (project number `1092534567115`) |
| **App Hosting backend** | `webmcpaac`, region `us-east4` |
| **TURN** | Cloudflare Realtime, credentials in Secret Manager |
| **Tests** | 268 passing |
| **Source files** | 71 across `src/`, `public/workers/`, `public/worklets/`, `signaling/`, `scripts/` |

### What works, verified in production

- On-device speech recognition (streaming Zipformer) and synthesis, no audio egress
- Cross-origin isolation active, `SharedArrayBuffer` available, multi-threaded inference
- Automatic listening on load, dictation straight into the conversation
- Speaker separation by pitch, with mid-utterance splitting and live identification
- Live waveform tinted by the detected voice
- Two-peer calls with Real-Time Text over HTTP long-polling
- Cloudflare TURN with a confirmed `relay` candidate
- All four WebMCP tools registered; both spec dialects supported
- Both of the specification's WebMCP acceptance examples reproduce verbatim

### What is not verified

- **Media actually flowing over the TURN relay.** The relay is reachable from an
  open network, which is the weaker half of the test. Confirming it needs a peer
  behind symmetric NAT — an LTE hotspot is usually enough.
- **Offline boot.** Service workers do not register in the browser available
  during development, so the offline path was never exercised end to end.
- **The two-device microphone isolation test** (RAUR §1 in
  [VERIFICATION.md](VERIFICATION.md)) — needs two machines in two rooms.
- **WebMCP against a real agent.** Everything was driven through the local tool
  registry, which exercises the same handlers but not the browser's agent surface.

---

## 2. Rebuild order

If this had to be rebuilt from an empty repository, this is the sequence. Steps
2 and 3 are the ones with hidden dependencies.

1. **Scaffold.** Vite + React + TypeScript, strict. `npm install`.
2. **Cross-origin isolation before anything else.** `COOP: same-origin` and
   `COEP` on the dev server, the preview server and the production origin. The
   WebAssembly speech engines are single-threaded without it, and the failure is
   silent — audio just stutters under load. Nothing downstream is worth building
   until `crossOriginIsolated` reports `true`.
3. **Model hosting.** See §4. This decides the COEP mode, so it cannot be
   deferred.
4. **Audio graph.** Two `AudioContext`s — capture at 16 kHz, playback at native
   rate. Declarative routing model with reachability assertions.
5. **Speech engines.** Classic workers, `importScripts` the Sherpa glue.
6. **Signalling.** HTTP long-polling, not WebSockets. See §5.
7. **WebRTC.** Perfect negotiation, data channel before the first offer.
8. **WebMCP tools.** Bound to `AbortController`, both API dialects.
9. **TURN.** Runtime endpoint minting credentials; never in the client bundle.
10. **Speaker separation.** Pitch and brightness, with correction UI.

---

## 3. Decisions that are not obvious

### Two AudioContexts, not one

The microphone lives in a 16 kHz capture context that owns **no** outbound sink —
no `destination` connection, no `MediaStreamAudioDestinationNode`. Synthesis and
the peer connection live in a separate playback context.

This makes "the microphone must never reach the peer" close to structurally
impossible rather than a convention a refactor could break. Under BIPA that
distinction is the whole product. Capture worklets also declare
`numberOfOutputs: 0`, so they cannot be connected onward at all.

### The routing model is separate from Web Audio

Every edge created in Web Audio is mirrored into a plain graph in
`src/audio/routing.ts`, and the compliance rules are evaluated as reachability
over that model. It makes the privacy claim testable in unit tests, and the
Diagnostics panel can display the live topology.

### Dictation goes into the conversation, not the message box

Routing dictation to the message box is defensible — it avoids implying words
were spoken aloud that never were — and it was wrong. It is not what someone
dictating wants, and choosing it unilaterally made the device feel deaf. It is a
setting now, defaulting to the conversation.

### The agent stages speech rather than speaking

`speak-text` is the only consequential tool and it stages a sentence for a
confirming tap by default. A user who cannot speak quickly also cannot quickly
retract words said in their name. Direct speech exists behind an explicit
setting, chosen by the user.

### Pitch, not the diarization model

Speaker separation uses fundamental frequency plus zero-crossing rate because
the frames are already in hand and it costs microseconds. Sherpa ships a real
diarization model with speaker embeddings — 44 MB on top of the 311 MB already
downloaded — which is the correct upgrade if pitch proves insufficient in a real
room. Pitch cannot separate two similar adult voices, and no amount of tuning
changes that.

---

## 4. Infrastructure, and why it is arranged this way

### Model weights: Firebase Hosting, not Cloud Storage

The weights are ~311 MB. The ASR data file alone is 182 MB, over GitHub's 100 MB
per-file limit, so they cannot live in the repository — and App Hosting builds
from the repository, so they cannot be in the container either without
downloading them on every build.

**Cloud Storage was the first choice and had to be abandoned.** The organisation
enforces Domain Restricted Sharing (`iam.allowedPolicyMemberDomains` limits
members to one customer ID), so `allUsers` cannot be granted `objectViewer` and a
public bucket is impossible. The error is `HTTP 412: One or more users named in
the policy do not belong to a permitted customer`.

Firebase Hosting serves publicly without IAM, dodging the policy entirely, and it
can set arbitrary response headers — which Cloud Storage cannot. That second
point matters more than the first: it lets us keep the specification's
`COEP: require-corp`, because the models can send
`Cross-Origin-Resource-Policy: cross-origin`. On Cloud Storage we would have been
forced to `credentialless`, losing cross-origin isolation on Safari.

Deploy them with `firebase deploy --only hosting:models`. The site is
`webmcp-aac-models`, scoped by a target in `.firebaserc` so it can never touch
the other sites in the project.

### Model URLs carry the version

`/asr-v1.13.6/…` rather than `/asr/…`. They are served `immutable` with a
one-year lifetime, which is only honest if the URL changes when the bytes do.

### TURN credentials are minted at runtime

`VITE_ICE_SERVERS` is inlined at build time, so anything placed there is readable
by anyone who opens the page — and a leaked relay credential means carrying
strangers' traffic on your bill. `/api/ice-servers` mints them server-side
instead, cached until near expiry, degrading to STUN with a notice if the
provider is unreachable.

Cloudflare's credential is two halves: the Token ID sits in the request URL and
the API token in the header. Both are Secret Manager secrets
(`turnCredentialsUrl`, `turnAuthHeader`); neither appears in git.

### `maxInstances: 1`

Signalling room membership lives in process memory. With several instances and no
shared state, two people entering the same room code can land on different
containers and never see each other. Raise it only after configuring `REDIS_URL`
or moving signalling out.

---

## 5. Traps that cost hours

Everything below was found the hard way. Each one presented as something other
than what it was.

### App Hosting's edge refuses WebSocket upgrades

**Symptom:** real-time text never opened; the call panel sat on "reconnecting".

The edge answers a valid handshake with `403 Forbidden` and a synthesised
`Sec-WebSocket-Accept`, **before the request reaches the container** — for every
path, including ones the origin would have rejected itself. Plain HTTP to the
same path returns the origin's own 404, which is how you can tell.

**Fix:** the origin signals over HTTP long-polling at `/api/signal/*`. Room logic
lives in `signaling/rooms.js`, shared with the WebSocket transport so the two
cannot drift. The client picks its transport from the endpoint scheme, so a
standalone regional server on a host that does permit upgrades still uses
WebSockets.

Long-polling rather than SSE because every response completes normally, so no
proxy can buffer a stream and stall call setup.

### ETags made deploys invisible

**Symptom:** fixes were live on the origin while the browser ran a bundle from
two deploys earlier. Cost more time than any other single issue, because it makes
a working fix look broken — so you "fix" it again.

The ETag was `size + mtime`. The container build normalises mtimes, and `sw.js`
and `index.html` come out the **same length** every build because the asset
hashes they embed are fixed-length. Two different deploys therefore served
byte-identical ETags. Every conditional request got a 304, and
`registration.update()` found nothing to install because the worker script itself
came back 304.

**Fix:** revalidated resources hash their content (`http-cache.js`). Immutable
ones keep the cheap ETag — their URL already carries a hash. Deliberately not
memoised: any cache key cheap enough to be worth having would be size and mtime,
the very pair that is untrustworthy.

### Service workers serve stale shells anyway

Even with correct ETags, a worker holding the precached shell will serve the
previous build until it decides to update.

**Fix, in layers:** `navigateFallback: null` with a NetworkFirst navigation
route, so an online device always gets the current shell and an offline one still
boots from cache. Plus `/api/build` — a path no worker intercepts — which the
page queries on startup; if it is behind, it clears the workers and reloads
**once per build**, so an unfixable mismatch degrades to a stale page rather than
a reload loop.

### Compliance assertion blocked the microphone

**Symptom:** the browser's recording indicator never lit. Dictation only worked
during a connected call.

`attachMicrophone` asserted the **entire** rule set, including
`Spec/contextual-harvesting`, which requires a `remote → asr` path that only
exists once a peer's audio is attached. So the assertion failed and the
microphone was detached the instant it was acquired.

**Fix:** applicability is respected. Prohibitions — no path from microphone to
peer, none to speakers — are unconditional and always evaluated; rules asserting
a path *must exist* are skipped only when the nodes they describe do not exist
yet. The display path already did this; the enforcement path did not, and that
mismatch was the bug.

### Every failure to identify a voice became the user's own words

**Symptom:** several people speaking, every one appearing as the user.

Two faults compounding. The level gate for pitch collection sat at −40 dBFS,
which admits someone holding the device and excludes someone across the room — so
no pitch was ever collected for a distant speaker. And unattributed fell through
to "this is the user", so every identification failure silently became a blue
bubble.

**Fix:** gate lowered to catch a voice from across a room; the pitch estimator
itself rejects anything unvoiced. Unattributed dictation now shows as
"Unidentified voice" on the other side.

### One person became five speakers

**Symptom:** Diagnostics showed 182 Hz, 198 Hz, 258 Hz, 309 Hz — five speakers
where there were not five people.

182 and 198 Hz are 145 cents apart, comfortably inside the pitch tolerance. The
**brightness veto** was rejecting every match: a 0.045 zero-crossing tolerance is
far tighter than the variation between two sentences by the same person.

**Fix:** brightness only overrules a pitch match when the gap is wide enough to
be a genuinely different voice; below that it ranks candidates rather than
vetoing them.

### The attribution never reached the turn

**Symptom:** Diagnostics said `speaker-1 · matched an existing voice` while every
bubble read "Unidentified voice".

`upsertTurn` built its result by listing fields by hand, and `speakerId` and
`voice` were never added to that list when they were introduced. Every update
silently discarded both. **TypeScript had nothing to object to** — both fields
are optional, so leaving them out is valid.

**Fix:** the merge spreads the existing turn and the incoming patch before
applying required defaults, so a new optional field carries through without
anyone having to remember.

### Auto-scroll depended on events that never fired

The transcript decided whether to follow from a flag set by `scroll` events, and
the scroll ran inside `requestAnimationFrame`. Both are unreliable: some browsers
do not fire scroll events in that context, and animation frames never arrive in a
background or non-compositing tab.

**Fix:** the decision compares the scroll position against the previous maximum —
no events. The scroll runs in a layout effect, where reading `scrollHeight`
forces layout synchronously.

### Three upstream Sherpa bundle traps

Documented in commit `0a21471`. Read that commit message before touching the
speech workers.

### A stub Prompt API that echoed its input

A browser exposed `LanguageModel`, reported itself available, and returned the
prompt back with a preamble. That text went straight into the composition
buffer — one tap from being spoken as the user's own words.

**Fix:** the tier proves itself with a canary prompt before it is trusted, and
validates every response.

---

## 6. Process lessons

Worth as much as the technical notes.

**Silent no-op edits.** Several bugs were introduced by string replacements that
matched nothing and failed silently — including the `upsertTurn` field omission
and the `/api/build` endpoint. Every scripted edit should assert its anchor
exists and abort otherwise, and the output should be checked rather than assumed.

**Verify gates must actually gate.** A type error reached the remote because
`npm run verify` and `npm run build` were separate commands and only the git
chain was joined with `&&`. A pre-push hook would have caught it.

**Test the mic path with a synthetic stream.** `getUserMedia` is blocked in
development browsers, which meant every microphone bug reached the user instead
of us. A `MediaStreamAudioDestinationNode` driven by an oscillator produces a
real `MediaStreamTrack` and exercises the entire attach path — worklet, VAD,
level meter, ASR — without touching a device. This was available the whole time
and should have been used from the start.

**Measure before diagnosing.** A canvas reported 1px wide, which looked like a
CSS bug; the browser pane simply had no layout, and the whole app measured 0px.
Walking the ancestor chain settled in one call what reasoning would not have.

**Instrument rather than argue.** "Why isn't the microphone prompting" was
resolved by wrapping `getUserMedia` and looking, after several rounds of
speculation. The Diagnostics panel exists for the same reason and earns its keep:
tuning the voice separator blind is how it came to be mis-tuned.

---

## 7. Commit history

Roughly chronological. Commit messages carry the detailed reasoning; this is an
index.

| Commit | What it did |
| --- | --- |
| `66f81e2` | The whole Blueprint 2 implementation — audio, speech, WebRTC, WebMCP |
| `71e8ce8` | GCP backend: model bucket and runtime TURN credentials |
| `06ae762` | Moved models to Firebase Hosting after DRS blocked a public bucket |
| `0a21471` | Three upstream Sherpa bundle traps |
| `e3c0f06` | Versioned model URLs |
| `ad64e05`, `c5e2caa`, `f126d8c`, `303b3f0` | The stale-deploy saga: ETags, network-first shell, self-healing build check |
| `eabd8be` | HTTP signalling after discovering the edge blocks WebSockets |
| `4ee011a` | Microphone blocked by its own compliance assertion |
| `0bd0c53`, `7274d49`, `a087643` | Automatic listening: restored, prompted on load, started before models finish |
| `62eb38e` | "Getting ready" distinguished from "Listening" |
| `37df456` → `1c91478` | Speaker separation: pitch, brightness, attribution plumbing, mid-utterance splitting |
| `cf7a0c6`, `7aa69b5` | Live waveform and live speaker identification |
| `4d236d8` | Full-height conversation column |
| `b8d6d51` | WebMCP research brief |

---

## 8. Open work

- **Media over TURN** under symmetric NAT — the untested half.
- **Offline boot**, never exercised.
- **Speaker diarization model** — done: pitch proved insufficient in a real
  room (one looped video became six speakers; two videos merged into one), and
  the MFCC-timbre interim fix hit the single-channel ceiling from both sides.
  Voice attribution now runs on a CAM++ speaker-verification network
  (3D-Speaker, VoxCeleb English, ~29 MB ONNX) via onnxruntime-web in a Web
  Worker: kaldi-fbank features in JS (`src/speech/fbank.ts`), utterance
  voiceprints compared by cosine with per-kind thresholds
  (`src/speech/speakers.ts`), attribution asynchronous so the turn renders
  immediately and the label lands a beat later. Fail-soft throughout: until
  the model loads (or if it never does), the pitch + timbre heuristics carry
  attribution exactly as before. `npm run fetch:models` now pulls the model;
  deploying it to the models host is `firebase deploy --only hosting:models`
  (VITE_SPEAKER_MODEL_URL is already set in apphosting.yaml). Still open:
  tuning the neural thresholds against field data from the Checks panel.
- **Pre-push hook** running `npm run verify`.
- **Scale-out** needs `REDIS_URL` or a separate signalling deployment before
  `maxInstances` is raised.
- **Interface redesign for AAC users** — scoped in
  [DESIGN_BRIEF.md](DESIGN_BRIEF.md), grounded by the external research report
  ("Strategic Interface Redesign for AAC Systems"). The first pass has landed:
  communicator-centric layout (output ribbon on top, quarantined suggestion
  strip, navigation spine, generative board owning the screen; transcript
  demoted to a "Listen" view), the 36-word Universal Core board, Modified
  Fitzgerald Key colour coding, symbol + text vs. text-only presentation
  toggle, 80px/8px locked grids, WCAG 2.4.13 dual-ring focus, a true
  yellow-on-black high-contrast palette, pinned instant-speak emergency
  phrases with a perimeter flash, and debug output removed from the
  transcript.

  The second pass ([DESIGN_BRIEF_2.md](DESIGN_BRIEF_2.md), specified by the
  follow-up research report) has landed too: word-level repair (⌫ Word plus
  restore-after-Speak); the suggestion strip rebuilt as two fixed lanes with
  strict content priority so nothing interactive ever renders clipped;
  in-transcript speaker repair (rename / claim / forget from the turn label),
  a junk-turn policy that collapses low-content dictated fragments, and
  outlined dictated-but-unspoken bubbles; row–column switch scanning
  (auto and two-switch step, Space/Enter, adjustable rate, hold-two-seconds
  global interrupt straight to the emergency bar); pointer-based dwell
  selection (350–1000ms, centre-out ring, fire-once-per-target, rest zone);
  fringe folders on fixed slots with the hold-to-unlock caregiver editing
  flow (hatched frame, in-place cell editor, automatic Fitzgerald colouring)
  and progressive masking of core words; cells that grow beyond the 80px
  floor to consume the viewport; dedicated `--danger-fill` tokens fixing the
  dark-mode emergency contrast; and assertive-only-when-active emergency
  announcements for concurrent screen readers.

  Still open from the research: **ARASAAC symbol binding** — deliberately
  deferred, not forgotten. Its CC BY-NC-SA licence needs a product decision
  (the NC/SA terms bind the whole app's distribution), and runtime symbol
  fetching must be reconciled with the egress audit and offline-first cache
  before any code is written. Emoji remain the offline stand-in. Also open:
  voice/message banking (research §08).
- **Rotate the Cloudflare TURN credential** if the one pasted into a chat
  transcript during setup was never replaced.
