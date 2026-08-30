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

## The local-first architecture

Recognition always begins in WebAssembly inside the user's browser. A signed-out
session sends no captured utterance to the server. A user signed in with ChatGPT
enables a second accuracy pass: after ONNX finishes a turn, that bounded WAV is
sent through the authenticated same-origin route to OpenAI `gpt-transcribe`.
There is no continuous cloud microphone stream, and failure leaves the local
text intact. This opt-in path requires appropriate notice and consent; this
document is not a substitute for legal review.

| Signal | Where it goes | Biometric? |
| --- | --- | --- |
| Microphone PCM | AudioWorklet → WASM recogniser, same tab | Yes — local-first |
| Completed utterance WAV | OpenAI transcription, signed-in sessions only | Yes — consent and retention rules apply |
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

## Cloud recognition paths

The supported accuracy path is the signed-in `gpt-transcribe` second pass. It
uploads only the captured audio for a completed turn, never blocks the ONNX
result, does not send audio to the call peer, and is disabled immediately on
sign-out. The server does not persist the uploaded file in application storage.

The older platform recognition provider is a separate exception:

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

Nothing leaves the device in a signed-out session and nothing is stored by the
SpeakAhead application server.

| Data | Where | Lifetime |
| --- | --- | --- |
| Audio buffers | Browser memory; signed-in completed turns may be sent to OpenAI | Freed per utterance; never written to SpeakAhead storage |
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
