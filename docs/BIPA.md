# Biometric privacy

## The obligation

The Illinois Biometric Information Privacy Act (740 ILCS 14) treats a voiceprint
as a biometric identifier. Collecting one requires written notice and consent,
a published retention schedule, and destruction on a defined timeline. Section
15(c) prohibits profiting from it; 15(d) restricts disclosure. BIPA carries a
private right of action, and damages accrue per violation.

This is not incidental to an AAC device. Users may have dysarthric speech —
which is to say, unusually identifying speech. Routing that audio to a cloud
transcription API would make every utterance a collection event.

**This is engineering documentation, not legal advice.** It describes what the
software does. Whether a particular deployment satisfies BIPA is a question for
counsel, and depends on facts beyond this repository.

## The architectural answer

Do not collect. Recognition runs in WebAssembly inside the user's browser. The
only audio that crosses the network is the *synthesised* voice, which is
generated from text by a model and is not a recording of anyone.

| Signal | Where it goes | Biometric? |
| --- | --- | --- |
| Microphone PCM | AudioWorklet → WASM recogniser, same tab | Yes — never transmitted |
| Recognised text | Application state; optionally the data channel | No |
| Synthesised voice | Speakers and the peer connection | No — machine-generated |
| Remote peer audio | Speakers and the local recogniser | Theirs; likewise never re-transmitted |

## How it is enforced

Three independent mechanisms, because a comment in a file is not an enforcement
mechanism.

**1. Structural separation.** The microphone and the peer connection live in
different `AudioContext`s. The capture context has no `MediaStreamAudioDestinationNode`
and no connection to `destination`. There is no node in that graph that leads
anywhere off the device. Capture worklets are constructed with
`numberOfOutputs: 0`, so they cannot be connected onward at all.

**2. A runtime invariant.** Every edge created in Web Audio is mirrored into a
declarative graph (`src/audio/routing.ts`). `assertCompliance()` evaluates
reachability and throws `RaurViolationError` if a path exists from `microphone`
to `peer`. It runs on every microphone attach, and the live results are visible
in the app's **Diagnostics** panel. It catches indirect leaks — routing the
microphone into the TTS bus fails the check just as directly wiring it to the
peer does.

**3. A build-time audit.** `npm run audit:egress` runs in CI. It performs
structural checks (the rule still exists; the assertion still runs; the capture
node still declares zero outputs; the recognition worker contains no network
call at all) and scans every network-sending call site for audio-shaped
arguments. Anything it flags must be added to an allowlist with a stated reason,
which puts the justification in the diff where a reviewer will see it.

## The consented exception

`WebSpeechAsrProvider` uses the platform `SpeechRecognition` API, which in
Chrome streams microphone audio to a Google service. **That configuration is not
BIPA-compliant.**

It exists because a user with no models installed and no other way to
communicate is worse off than one who has been told the trade-off and chosen it.
Its handling reflects that:

- off by default, behind an explicit setting;
- only reachable when no on-device model loaded;
- reports `offline: false`, so the status bar shows it as a cloud engine;
- raises a persistent warning naming BIPA;
- allowlisted in the egress audit with that reasoning recorded.

An operator deploying in Illinois should leave it off, and can remove the
provider entirely if they would rather it not be reachable.

## What is stored

Nothing leaves the device by default and nothing is stored server-side.

| Data | Where | Lifetime |
| --- | --- | --- |
| Audio buffers | WASM linear memory | Freed per utterance; never written to disk |
| Transcript | React state | Cleared on reload; capped at 250 turns |
| Settings | `localStorage` | Until the user clears site data |
| Room codes | Signalling server memory | Discarded when the room empties |

The signalling server never sees audio or transcripts — only SDP and ICE
candidates. Real-time text travels peer-to-peer over the DTLS-encrypted data
channel and does not pass through the signalling server.

## If you change the audio graph

Run `npm run verify`. If the egress audit flags your change, the burden is to
explain why the path is safe — in the allowlist, in the diff — rather than to
silence it.
