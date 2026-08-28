# RAUR compliance

Mapping from the [W3C RTC Accessibility User Requirements](https://www.w3.org/TR/raur/)
to what the code does.

## Why the routing is unusual

A conventional WebRTC application captures the microphone and attaches it to the
peer connection. For an AAC user that is the wrong behaviour in several ways at
once:

- their screen reader is audible in the room and would be transmitted;
- ambient noise and involuntary vocalisations would be transmitted;
- their synthesised voice — the thing they actually want heard — is not
  connected at all.

So the microphone is an *input to local inference only*, and the synthesised
voice is the only thing on the wire.

## Requirement mapping

### User Need 5 — separate management of audio outputs

> A user of speech and AAC, or a blind user operating a screen reader
> simultaneously, must be able to manage audio and other outputs separately.

| Signal | Handling |
| --- | --- |
| Physical microphone | 16 kHz capture context → `ChannelSplitterNode` → capture worklet → recogniser. No path to speakers or peer. |
| Screen reader | Rendered by the OS. Never enters a programmable audio graph, so it cannot be captured or transmitted. |
| Synthesised voice | TTS bus → local monitor → speakers, *and* → `MediaStreamAudioDestinationNode` → peer. |
| Remote peer | → monitor gain → speakers, *and* → capture worklet → recogniser for context. |

Enforced by `COMPLIANCE_RULES` in `src/audio/routing.ts`, evaluated on every
graph mutation and displayed live in **Diagnostics**.

### User Need 11 — communication in an emergency

> An AAC user must be able to communicate effectively in an emergency.

`setEmergencyOverride(true)`:

- disconnects remote audio from `destination` and zeroes its gain, so nothing
  can talk over the user;
- drives the TTS bus and local monitor to unity ceiling;
- stops any synthesis in flight, so a queued sentence cannot delay an urgent one;
- announces the state to the peer over the data channel;
- reflects the change in an `aria-live` region.

It is a **latch, not a hold**. Someone in distress should not have to keep a
finger on a control. The button is permanently visible rather than in a menu: a
control you have to find is a control you do not have.

The **Urgent** phrase board bypasses the confirm-then-speak flow and speaks on
the first tap, for the same reason.

### User Need 13 — distinguishing incoming from outgoing text

> Deaf or deaf-blind users must be able to visually or tactilely differentiate
> between incoming and outgoing text.

Every turn is distinguished four independent ways, so no single sensory channel
is load-bearing:

1. **Words** — "You said" / "Partner said", read out by a screen reader.
2. **Position** — outgoing right-aligned, incoming left-aligned.
3. **Colour** — distinct hues with a heavy inline border.
4. **Structure** — `role="log"` with `aria-live="polite"`, each turn its own
   `<article>` with a header.

Real-Time Text updates one message in place under a stable id. An earlier
revision minted a fresh id per keystroke, which gave the partner a new line for
every burst of typing, each stuck at "still speaking" — precisely the confusion
this requirement exists to prevent. A cleared message sends an empty final
update, so a half-typed thought is retracted rather than left hanging.

Text is transmitted **before** synthesis begins. If synthesis is slow, or the
voice cannot be routed at all, the partner still receives the words.

## Beyond the specification

**Agent-authored speech is staged, not spoken.** By default `speak-text` places
the agent's sentence in a confirmation strip that says *"An agent wrote this for
you — you decide whether to say it"*, with Speak / Edit / Discard.

The specification's feedback loop has the agent acting autonomously. For
prediction and expansion that is right — they propose, the user chooses. For
speech it is not: an AAC device *is* the user's voice, and a user who cannot
speak quickly cannot quickly retract words said on their behalf. Users who want
the speed can enable direct speech in Settings. This is a deliberate deviation.

## General accessibility

- Minimum 48px targets, 60px with large text enabled.
- Full keyboard operation; visible focus rings; a skip link to the message box.
- High-contrast and large-text modes independent of the OS theme.
- `prefers-reduced-motion` honoured.
- Colour never the sole carrier of meaning.
- Errors phrased as what happened and what to do, never as codes.
