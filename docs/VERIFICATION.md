# Verification

The specification states its confirmation protocols as manual rituals — open the
console, type `typeof SharedArrayBuffer`, take heap snapshots, put two engineers
in two rooms. Rituals that depend on someone remembering to perform them do not
survive contact with a delivery schedule.

Everything checkable in-process has been automated. What genuinely needs hands,
hardware or a browser flag is listed at the end, honestly.

## Automated

```bash
npm run verify          # typecheck + 123 unit tests + BIPA egress audit
```

| Specification protocol | How it is checked |
| --- | --- |
| COOP/COEP headers present | CI starts the built origin and greps the response headers; the build fails if either is missing |
| `typeof SharedArrayBuffer === "function"` | `detectPlatform()` at boot; shown in **Diagnostics**; a warning is raised if isolation is off |
| Microphone never reaches the peer | `assertCompliance()` on every attach; 6 unit tests including indirect leaks; CI structural audit |
| Synthetic voice reaches both speakers and peer | Reachability rules, evaluated live |
| Remote audio is transcribed for context | Reachability rule, evaluated live |
| Main thread stays unblocked | Capture runs in an `AudioWorklet`, inference in Workers; no PCM crosses the main thread except as a transferable |
| WASM heap stays stable | Providers poll `HEAPU8.byteLength` every 5 s; shown in **Diagnostics** as a live readout instead of a manual snapshot |
| Two-pass punctuation restoration | `restorePunctuation` unit tests; the offline second pass activates when `VITE_SHERPA_REFINE_BASE` is set |
| Anti-aliased 16 kHz capture | Resampler tests assert a 15 kHz tone is attenuated >20 dB relative to passband, so it cannot fold into the speech band |
| WebMCP tools registered and torn down | 12 tests covering both spec dialects, `AbortController` teardown, returned-unregister teardown, and a throwing agent surface |
| `predict-conversational-phrase` on the drink question | Unit test asserts the specification's three expected replies |
| `expand-semantic-shorthand` worked examples | Unit tests assert `"water cold please"` → `"I would like some cold water, please."` and `"apple juice"` → `"I would like some apple juice, please."` |
| Signalling relay correctness | 13 hub tests: join, relay isolation, disconnect, room reuse, full rooms, malformed input, cross-replica broadcast |

## In-app: the Diagnostics panel

Open the app and choose **Diagnostics**. It shows, live:

- every compliance rule and whether it currently holds;
- the actual routing matrix, every edge, as built;
- cross-origin isolation, `SharedArrayBuffer`, WebAssembly threads, usable
  thread count, capture and playback sample rates, WASM heap sizes;
- registered WebMCP tools and whether a browser agent surface is attached.

Two buttons execute the specification's agent protocol on browsers with no
WebMCP implementation, by driving the same handlers an agent would reach:

- **Simulate a partner turn** injects *"What would you like to drink with your
  lunch today?"*, calls `get-conversation-context`, and runs the prediction
  ladder. Expected: three drink-appropriate replies appear as chips.
- **Test shorthand expansion** runs `"apple juice"` through the expansion path.
  Expected: *"I would like some apple juice, please."*

## Observed results

Run against the production build on 2026-08-27, Chromium, `http://127.0.0.1:8080`:

| Check | Result |
| --- | --- |
| `crossOriginIsolated` | `true` |
| `typeof SharedArrayBuffer` | `"function"` |
| WebAssembly threads | supported |
| Capture / playback rate | 16000 Hz / 48000 Hz |
| Compliance rules on a live call | 5 of 5 pass |
| Routing matrix | `tts-bus → peer`, `remote → remote-capture → asr`, `local-monitor → speakers`; no microphone edge to any output |
| Two-peer call | connected; data channel open; peer name exchanged |
| Real-Time Text | incremental updates resolved into one finalised line |
| Prediction from the partner's turn | "Water, please." / "I'll have iced tea." / "Nothing for me, thanks." |
| Shorthand expansion | `"water cold please"` → `"I would like some cold water, please."` |

### Deployed configuration

Project `vpx4900`, backend `webmcpaac` (us-east4), models on a dedicated
Firebase Hosting site. Verified on the live URL:

| Check | Result |
| --- | --- |
| Cross-origin isolation with `require-corp` **and** cross-origin models | `crossOriginIsolated: true`, `SharedArrayBuffer: function` |
| Recogniser | on-device, 512 MB heap, ready in ~46 s cold |
| Synthesiser | on-device, routable to a peer — no fallback warning |
| Shorthand expansion | `"water cold please"` → `"I would like some cold water, please."` |
| Compliance rules | all applicable rules pass |
| `/api/ice-servers` | Cloudflare Realtime credentials minted per request |
| Signalling | HTTP long-polling; two-peer call connects, RTT opens |
| Real-time text | one turn per message, correctly cased, predictions fire |
| TURN relay | **Reachable** — candidates `host, srflx, relay` |

Defects found by running it, all fixed with regression tests:

1. **A stub Prompt API was trusted.** The browser exposed a `LanguageModel` that
   reported itself available and echoed its prompt back. Its output went
   straight into the composition buffer — one tap from being spoken as the
   user's own words. The tier now proves itself with a canary prompt before it
   is used, and validates every response. (`tests/onDeviceModel.test.ts`)
2. **Real-Time Text minted a new id per keystroke.** The partner accumulated a
   new "still speaking" line per burst of typing, and the final message arrived
   as yet another line. Composing now holds one stable id until the message is
   sent or retracted. (`tests/store.test.ts`)
3. **Early ICE candidates were discarded.** Candidates gathered before the
   remote peer joined were dropped, so the first joiner sometimes offered
   nothing to connect to and the call failed after the ICE timeout. They are now
   buffered and flushed. Reproduced, fixed, and re-verified.
4. **Deployed updates never reached the browser.** The service worker used
   `registerType: 'prompt'` without `skipWaiting`, so a new worker waited for
   every tab to close before activating. On a device people leave open that is
   functionally never: the old precache kept serving the old shell, and a fixed
   build looked broken because the browser was still running the previous one.
   Several "production" checks were in fact testing a stale bundle before this
   was spotted.
5. **Model URLs were mutable but served `immutable`.** Bundles were overwritten
   in place at `/tts`, so browsers and the CDN correctly served the old model
   for a year. Paths now carry their release (`/tts-v1.12.37`).
6. **Signalling was silently dead in production.** The bundled WebSocket server
   worked locally and could never work on the deployed host: App Hosting's edge
   answers a valid upgrade with 403 before it reaches the container. Real-time
   text never opened and the call panel sat on "reconnecting". Replaced with
   HTTP long-polling on the same origin, sharing room logic with the WebSocket
   transport so the two cannot drift.
7. **ETags made deploys invisible.** Derived from size and mtime — but the
   container build normalises mtimes, and `sw.js` and `index.html` are the same
   length every build because the asset hashes they embed are fixed-length. Two
   deploys produced byte-identical ETags, every conditional request got a 304,
   and browsers kept a stale worker and shell indefinitely. This was the real
   cause of the staleness; the `skipWaiting` fix was necessary but not
   sufficient. Revalidated resources now hash their content.
8. **The partner's words appeared twice**, once as their real-time text and
   again in block capitals from transcribing their synthesised speech. RTT is
   now authoritative; contextual harvesting still runs for a partner not using
   this app.
9. **Dictation wrote into the transcript**, claiming the user had said aloud
   something never spoken or transmitted. It now fills the composition box for
   review, which is what the Dictate button implies.
10. **Three upstream bundle traps** — a voice-cloning TTS model that cannot speak
   without reference audio, a pthread build that hangs during bootstrap, and a
   helper whose default model path does not match its own archive. See
   `docs/MODELS.md`; each also breaks the bundle's own demo page.

## Still manual

These need hardware, a second person, or a browser flag. Each is written so it
can be executed without reading the source.

### 1. Microphone isolation, two devices, two rooms

Two machines on different networks, in separate rooms so acoustic feedback
cannot mask the result.

1. Both join the same room code. Confirm **Call: connected**.
2. On A, enable dictation and speak continuously. Run a screen reader at high
   volume.
3. **On B, confirm silence.** Any audio from A's room is a failure.
4. On A, type "Testing auditory segregation" and press Speak.
5. **On B, confirm** the synthetic voice is audible *and* the text appears in
   the transcript labelled "Partner said".

Step 3 is the one that matters. Steps 4–5 confirm the intended path still works.

### 2. True offline operation

1. Load the production URL and let the service worker finish caching
   (**Application → Service Workers** in DevTools).
2. Disable Wi-Fi and Ethernet entirely.
3. Reload.
4. **Confirm** the app boots from cache, the WASM engines instantiate, and
   dictation and synthesis both work. Calling is expected to be unavailable.

Requires `npm run fetch:models` first, and a browser that permits service
workers on the origin.

### 3. WebMCP with a real agent

Chrome with the WebMCP flag enabled, or an agent host that implements the API.

1. Open the app. **Confirm** the status bar reads **Agent attached** and
   Diagnostics lists five registered tools.
2. Have the agent call `get-conversation-context` and then
   `predict-conversational-phrase`. **Confirm** three chips appear.
3. Type `apple juice`; have the agent call `expand-semantic-shorthand`.
   **Confirm** the composition buffer is replaced.
4. Have the agent call `speak-text`. **Confirm** it is *staged for confirmation*,
   not spoken — unless direct agent speech has been enabled in Settings.

### 4. TURN relay under symmetric NAT

Cloudflare Realtime is configured and **Check connectivity** reports a `relay`
candidate on the deployed app, so the credential path is confirmed. What remains
is confirming media actually flows over the relay, which needs a hostile network:

1. Put one peer behind a restrictive NAT — an LTE hotspot is usually enough.
2. **Call → Check connectivity** on that device. Confirm `relay` appears there
   too; the relay being reachable from an open network proves less.
3. Place a call and confirm audio flows in both directions.

### 5. Sustained-load profiling

1. Install the models, enable dictation, record 60 s in the Performance panel
   while speaking continuously.
2. **Confirm** the main thread is idle between interactions and the flame chart
   shows work on the worklet and worker threads.
3. **Confirm** the recogniser heap readout in Diagnostics is stable rather than
   climbing.

### 6. Signalling round-trip under 100 ms

Two machines on different networks, against a regional deployment. Time from
`join` to `joined` in the Network panel's WS frames. The specification's target
is a sub-100 ms exchange from the Midwest.
