# Designing for the person who cannot speak — second round

**Design brief · Round two: repair, access, and vocabulary**

Round one landed. The layout now serves the speaker, the core board exists, the colours mean
something, and the debug output is gone. Then we used it in a real room for an evening, and the
first day of real use taught us more than the previous month. This brief is what it taught us,
plus the half of the research we have not built yet.

| | |
| --- | --- |
| **For** | Designer — interaction and visual; some items pair with an engineer |
| **Output** | Design rationale, then flows and screens |
| **Effort** | Three to four weeks |
| **Prerequisites** | [DESIGN_BRIEF.md](DESIGN_BRIEF.md) (round one) and [AAC_REDESIGN_RESEARCH.md](AAC_REDESIGN_RESEARCH.md) |

---

## What round one changed

For context, the first redesign delivered: an output ribbon with Speak persistent at the top; a
quarantined suggestion strip where everything machine-proposed appears; a vertical navigation
spine; the 36-word Universal Core board on the Modified Fitzgerald Key; a symbol/text-only
presentation toggle; 80px targets on locked grids; WCAG 2.4.13 focus rings; a real
yellow-on-black high-contrast palette; and pinned instant-speak emergency phrases.

The transcript was demoted to a "Listen" view. The agent still cannot speak unprompted. Those
decisions are settled — build on them, do not relitigate them.

---

## What the first real session showed

Written from a live evening session with the microphone on in a room with a podcast playing.
Screenshots exist; ask for them. These are observed failures, not suspicions.

### You can put words in, but you cannot take one out

The buffer read `I you he it it it` — a tremor double-tapped "it" three times. The only recovery
is **Clear**, which destroys the whole utterance and forces the user to rebuild it from nothing.
For a person at 12 words per minute, deleting five words to fix one is not an annoyance, it is
the loss of a sentence they may not have the energy to build twice. Every serious AAC system has
word-level delete. Ours has a nuclear option.

### The suggestion strip keeps its promise by cropping

The strip holds its fixed height so the board never moves — good — but when dictation state and
prediction chips are present together, the chips render half-clipped at the fold: three visible
scalps of buttons you cannot read. We traded reflow for amputation. The no-reflow rule stands;
the strip needs an information design that honours it without hiding interactive content
mid-pixel.

### The room produced six speakers, and none of them are real

Pitch separation labelled one podcast and one person as **Speaker 2 through Speaker 6**, produced
two near-identical transcriptions of the same sentence attributed to different speakers, and
committed junk micro-turns — `E budding.`, `Ta.`, `LIs detested l.` — as permanent conversation.
The tools to fix attribution (rename, merge by forgetting, "this is me") exist, but they are
buried in Settings, an entire view away from the transcript where the error is visible. The user
watches the mistake happen and the remedy is elsewhere.

### Dictated-but-unspoken turns read as contributions

The user's own dictation appears as full blue bubbles marked "not spoken aloud". In a busy
transcript they carry the same weight as things the room actually heard. The distinction exists
as a badge; it needs to exist as a glance.

### The board does not use the room it won

Round one fought to give the core board 75% of the screen, and then the board leaves the bottom
third of its area empty: the cells sit at their 80px minimum instead of growing into the space.
The research's instruction was "as large as the viewport physically allows". We stopped at the
floor.

### Dark-mode emergency buttons are the palest things on screen

HELP / PAIN / CAN'T BREATHE render as white text on pale salmon in dark mode — the dark theme's
`--danger` token was chosen for text on dark surfaces, and it is now doing duty as a button fill.
The emergency surface must be the highest-contrast element in every theme, measured, not assumed.

---

## What we want from you

In priority order. As before: three done properly beats seven sketched.

### 01 · Design repair

Word-level backspace on the composition buffer as a first-class board control — same size and
prominence as the words themselves, in a fixed position. Consider also: undo for an accidental
Speak (what does retracting an utterance mean socially?), and whether repair belongs on the
board, the ribbon, or both. Repair actions must work under scanning and dwell, not just touch.

*What good looks like:* the `I you he it it it` incident resolved in two selections, and the
control's position defensible to a motor-planning user.

### 02 · Re-design the suggestion strip's interior

The lane's height and position are fixed by the no-reflow rule; that constraint stays. Design
what happens *inside* it: how dictation status, agent-staged speech, and prediction chips share
the space; what has priority when they collide; what is scrollable, what is paginated, what is
simply not shown. Nothing interactive may ever render partially.

*What good looks like:* every combination of strip contents drawn, including the worst one, with
nothing clipped and the board unmoved.

### 03 · Put speaker repair where the speakers are

Naming, merging, and claiming a voice ("this is me") should be possible from the transcript
label itself, without leaving the conversation. Decide the policy for junk turns: below what
length or confidence does a turn get held, collapsed, or discarded rather than committed? And
make dictated-not-spoken turns visually subordinate to what the room actually heard.

*What good looks like:* the six-phantom-speakers session cleaned up in under a minute, from the
Listen view, and a transcript where spoken and merely-heard are distinguishable at arm's length.

### 04 · Switch scanning, for real this time

Round one built the DOM in scan order; nothing scans it yet. Design row–column scanning across
ribbon, strip, spine, board, and emergency bar: highlight treatment (it must satisfy the same
2.4.13 focus rules), step timing and its adjustment, two-switch step scanning with a reverse
switch, and — non-negotiable — the global interrupt that jumps the scan loop straight to the
emergency surface (the research suggests long-press or double-click of the switch).

*What good looks like:* the full scan model with timings, drawn as sequences; the emergency
reachable from any point in the loop in one gesture; an honest count of switch-hits-per-word for
the core board.

### 05 · Eye gaze and dwell

Dwell selection with a visible, centre-out progress indicator; user-adjustable dwell time
(350–1000ms per the research); rest zones where a gaze can park without selecting anything; and
target margins that tolerate calibration drift. State plainly what the browser can and cannot
know about gaze — if this ships as "works with an eye-tracker acting as a pointer", design for
that honestly.

*What good looks like:* dwell feedback specified to the millisecond and pixel, rest zones placed,
and the Midas-touch failure mode addressed rather than mentioned.

### 06 · Vocabulary that belongs to the user

Three linked pieces from the research, designed together because they share one grid:

- **Fringe folders** — People, Places, Food and the like, reachable from the spine, never more
  than two levels deep.
- **The caregiver editing flow** — sandboxed behind a deliberate unlock (PIN or long-hold), with
  an unmistakable "editing, not talking" visual state; in-place cell editing; automatic
  Fitzgerald colouring by word class so a parent never needs to know what a preposition is.
- **Progressive masking** — the full grid programmed from day one, words hidden and revealed in
  their permanent positions as competence grows, so the layout never changes underneath anyone.

*What good looks like:* a carer adds "my daughter Ellie" in under thirty seconds without being
able to break anything, and a beginner's four-word board is the expert's board with 32 cells
masked.

### 07 · Replace the emoji

The emoji on the boards are stand-ins and it shows — "in" is an arrow into a tray, "do" is a
lightning bolt. Specify the ARASAAC binding: which symbol for each of the 36 core words and the
stock phrases, how symbols are fetched and cached offline, how the caregiver flow binds a symbol
when a new word is typed, and what text-only mode gains in density when symbols are off.

*What good looks like:* the core board mocked with real ARASAAC symbols in both themes, and the
licensing note written (it is Creative Commons BY-NC-SA — check what that means for us).

---

## Constraints carried forward

All of round one's constraints hold: offline always, voice audio never leaves the device, the
agent never speaks unprompted, screen readers run simultaneously, emergency within one action.

Two new ones, earned by round one:

**Nothing reflows. Ever.** The fixed grids, the fixed strip, the fixed spine are now load-bearing
promises to motor-planning users. Any design that grows, shifts, or reorders them in response to
content is wrong, whatever it gains.

**The Fitzgerald Key is now a contract.** Colour means part of speech everywhere it appears. New
surfaces (folders, editing, scanning highlights) must extend the key, not improvise beside it.

---

## What to hand back

**Rationale first**, as before — argue the interaction model for repair, scanning, and editing
before drawing them.

**Flows as sequences** — scanning and dwell cannot be judged from static frames. Draw the loop.

**Tokens and timings** — dwell durations, scan steps, highlight treatments, the corrected
dark-mode danger values, and the rule for cells growing beyond their 80px floor.

**A test script for one real session** — the single most valuable artefact from round one was an
evening of real use. Write the protocol for the next one: what to attempt, what to measure
(selections per utterance, errors per utterance, time-to-repair), and what would falsify the
design.

---

## Where to look

**The live application** — <https://webmcpaac--vpx4900.us-east4.hosted.app/>. Try the failing
cases yourself: tap a word twice by mistake and try to fix it; run a podcast at the microphone
for ten minutes and watch the speaker list; fill the strip while dictating.

**The research report** — [AAC_REDESIGN_RESEARCH.md](AAC_REDESIGN_RESEARCH.md). Sections 03
(non-touch selection), 05 (personalisation and masking), and 08 (voice banking — deliberately
out of round two's scope, but read it so nothing you design forecloses it).

**The round-one brief** — [DESIGN_BRIEF.md](DESIGN_BRIEF.md), for the user profiles (Maria,
Julian, Robert) that every decision should still be argued against.

**The code that will receive this** — `src/components/CoreBoard.tsx` and `SuggestionStrip.tsx`
for the surfaces being redesigned; `src/state/store.ts` for what state exists; and
`src/speech/speakers.ts` for what the voice separator can actually tell the interface, which is
less than the transcript currently pretends.

**Reference implementations** — Apple Switch Control and Android Switch Access for scanning;
Tobii Dynavox Communicator and Grid 3 for dwell feedback and rest zones; LAMP Words for Life for
masking done right.
