# Designing for the person who cannot speak

**Design brief · Interface and visual system**

The engineering works. The interface was designed by engineers, for engineers, and it shows.
We need someone to redesign it for the people who will actually hold it.

| | |
| --- | --- |
| **For** | Designer — interaction and visual |
| **Output** | Design rationale, then screens |
| **Effort** | Two to three weeks |
| **Prerequisites** | None — this brief is self-contained |

---

## Who this is for

An **AAC device** — augmentative and alternative communication — is software for people who
cannot reliably speak. The person selects or types words and the device says them aloud in a
synthesised voice.

The users are not one group, and designing for the average of them serves none of them:

- **Someone after a stroke** with aphasia. Language comprehension may be intact while reading and
  word-finding are not. May have one usable hand.
- **Someone with cerebral palsy** who has used AAC since childhood. Likely fast and fluent with a
  familiar layout, and badly slowed by an unfamiliar one. May have significant motor impairment
  and use a head pointer, a switch, or eye gaze.
- **Someone with motor neurone disease** whose abilities are declining. What works this month may
  not work in six. Often begins with touch and ends with eye gaze.
- **Someone with severe dysarthria** who can speak but is not understood. May use the device only
  with strangers, and resent needing it at all.
- **A child** who is pre-literate. Cannot read the words on our buttons.

Two facts shape everything:

**Communication rate.** An unaided AAC user often manages fewer than 15 words per minute against
roughly 150 for speech. Every interaction either closes that gap or widens it.

**This device is their voice.** Not an app they use. When it speaks, everyone in the room believes
they said it. That changes what an error costs, what a delay costs, and what a confusing screen
costs.

---

## What it does today

Runs in a browser. Listens to the room and transcribes it on-device, so the user can see what was
said to them. Synthesises their replies. Can place a call where the synthesised voice is carried to
the other person alongside real-time text. Separates voices in the room by pitch so the transcript
labels who spoke. An AI agent can propose replies and expand shorthand into full sentences.

The current screen has, roughly: a conversation transcript on the left at full height; on the
right, a tabbed panel (Call / Settings / Diagnostics), then a message box with six buttons, then a
grid of quick phrases in four categories. A red emergency button is pinned along the bottom.

Try it before reading further: <https://webmcpaac--vpx4900.us-east4.hosted.app/>

---

## What is wrong with it

Written by the person who built it. This is not a list of things we suspect — it is a list of
compromises we made knowingly and have not fixed.

### The hierarchy serves the wrong person

The conversation transcript gets the largest, most prominent column. It is the part the user
**reads**. The controls they **operate** — the message box, the phrase board — are stacked below
call settings and diagnostics on the right. We optimised for the observer, not the speaker.

### Typing is the primary input, and it is the slowest one

The message box is a text field. For a user producing 15 words per minute, character-by-character
entry is the worst available path, yet it has the most visual weight and the largest button.
Quick phrases — far faster — are at the bottom, below the fold on many screens.

### There are 32 phrases, and no way to change them

Four categories of eight. They are our guesses at what someone might need. Real AAC vocabulary is
personal: names of the user's own family, their own medications, the phrases they actually say.
There is no way to add, edit, reorder, or remove any of it.

### Everything is words

No symbols. Real AAC systems use symbol sets — ARASAAC, Widgit, PCS, Bliss — because a large
portion of users cannot read, or cannot read reliably under stress. A pre-literate child and a
person with acquired aphasia are both locked out of a text-only board.

### Nothing supports switch access or eye gaze

Many users cannot touch a target accurately. They use one or two switches with a scanning
interface, or eye gaze with dwell selection. Neither is supported at all. This is not a polish
item; it is a population we currently exclude entirely.

### Debug output is in the production interface

Every dictated message carries a line like `198 Hz · 12/31 voiced · speaker-1 · matched an existing
voice`. That was added for diagnosis and never designed away. A user does not need it and it makes
the transcript harder to read.

### Layout is not stable, and stability is the whole game

Experienced AAC users rely on **motor planning** — the muscle memory of where a word lives.
Research consistently finds that consistent position matters more than icon quality. Our phrase
grid reflows with the viewport, categories change what occupies the same space, and predictions
appear and disappear above the message box, shifting everything under them.

### Targets meet the web standard, not this population's need

We use a 48px minimum, 60px with large text enabled. That is a general-purpose accessibility floor,
not a figure derived from users with tremor, spasticity, or limited range of motion.

### Settings hide the things that matter most

Text size, high contrast, speaking rate, and whether tapping a phrase speaks it immediately are all
buried behind a tab, below TURN configuration and consent toggles. The person who most needs larger
text is least likely to find the switch.

### The urgent phrases do not look urgent

"I cannot breathe well" sits in the same visual treatment as "Hello, good to see you". The only
distinction is which tab is selected.

---

## Constraints the design must work within

Not preferences. These are load-bearing.

**It must work offline.** Speech recognition and synthesis run on-device. No design may depend on a
network being present.

**Voice audio never leaves the device.** Under the Illinois Biometric Information Privacy Act a
voiceprint is a protected biometric identifier. This constrains what can be offered as a feature,
not usually what it looks like — but it rules out anything cloud-rendered from the microphone.

**The agent does not speak unprompted.** Anything an AI proposes is staged for a confirming action.
A design that makes confirmation feel like an obstacle will get people hurt; a design that makes it
invisible will put words in someone's mouth. This is a real design problem, not a checkbox.

**Screen readers are in play simultaneously.** Some users run a screen reader *and* this device.
The interface cannot rely on visual grouping alone, and it must not fight the screen reader for the
audio channel.

**Emergency access is never more than one action away.** From any state, including mid-sentence,
mid-call, and mid-error.

---

## What we want from you

Work in this order. We would rather have three of these done properly than seven sketched.

### 01 · Who exactly are we designing for?

Pick two or three concrete user profiles from the range above and commit to them. State what each
can do physically, what they can read, how they select, and how fast. Every later decision should
be arguable against these.

*What good looks like:* profiles specific enough that we can say "this screen fails Maria" and both
know what that means.

### 02 · What should occupy the screen, and in what proportion?

Re-argue the layout from the users up. Should the transcript be the largest element? Should the
board be the default surface with composition secondary? Is one screen right at all, or should the
device have modes?

*What good looks like:* two or three genuinely different layout concepts with the trade-offs named,
not one concept with variations.

### 03 · How does someone select, when they cannot point?

Design for switch scanning and eye gaze as first-class inputs, not adaptations. What is the scan
order? What does dwell feedback look like? How does a two-switch user reach the emergency phrase?

*What good looks like:* the scanning model drawn out, with timings, and an honest account of what
it costs a touch user.

### 04 · What is the symbol strategy?

Decide whether we support symbols, which set, and how they combine with text. Consider licensing —
some sets are free, others are not — and what happens for a user who reads fine and finds symbols
patronising.

*What good looks like:* a recommendation with licensing checked, and a board mocked up in both
symbol and text modes.

### 05 · How does vocabulary become personal?

Someone has to be able to add "my daughter Ellie", reorder what they use most, and delete what they
never use. Often that someone is a carer or therapist, not the user. Design that editing
experience, including how it stays out of the way during a conversation.

*What good looks like:* the editing flow, and a position on who edits and when.

### 06 · What is the visual system?

Only now. Colour, type, spacing, target sizes, states, motion. Justify the type sizes against
reading distance and the target sizes against motor impairment rather than against convention.
Both themes, plus a genuine high-contrast mode — not a filter over the existing one.

*What good looks like:* tokens we can implement directly, with the reasoning for the numbers.

### 07 · How does urgency look different from conversation?

"I cannot breathe well" and "Take care" should not share a treatment. Design the escalation —
including the emergency override, which currently mutes incoming audio and raises the user's voice
to full volume.

*What good looks like:* the urgent surface designed, and a rule for what qualifies.

---

## What to hand back

**Rationale before pixels.** A short document arguing the interaction model, with the user profiles
and the reasoning. If the argument is right, the screens follow; if it is wrong, beautiful screens
make it worse.

**Then screens.** The main communication surface, the phrase board including editing, the urgent
state, and one non-touch selection method shown as a sequence rather than a static frame.

**Design tokens** in a form we can implement — colour, type scale, spacing, target sizes, states.

**A list of what you would remove.** Ours is a screen built by accretion, and the most valuable
thing you can tell us is which parts should not exist. The debug readouts are the obvious start;
we expect there is more.

### Two things worth saying plainly

We will not treat "this needs user research with actual AAC users" as an evasion. It is the correct
answer, and if your recommendation is that we should not ship a redesign without it, say so and
tell us what the minimum viable study looks like.

And do not preserve our decisions out of politeness. The layout, the phrase categories, the
tabbed panel, and the emphasis on typing are all first drafts by people who were solving a
different problem.

---

## Where to look

**The live application** — <https://webmcpaac--vpx4900.us-east4.hosted.app/>. Chromium browsers.
Allow the microphone; the first load downloads around 300 MB of speech models, then works offline.
Try it once as yourself, then again using only one finger and without touching the keyboard.

**Our accessibility notes** — [RAUR.md](RAUR.md) explains the standard the call handling is built
against and the decisions already made about screen readers and the emergency override.

**Core vocabulary research** — the finding that a small set of words covers most of what anyone
says, and that those words should never move. Search "core vocabulary AAC" and "Project Core".

**Motor planning in AAC** — why consistent position beats better icons. The Unity and LAMP Words
for Life systems are the commercial expression of this idea; the research behind it is worth more
than the products.

**Symbol sets** — ARASAAC (free, Creative Commons), Widgit and PCS (licensed), Blissymbolics.
Check licensing before recommending.

**WCAG 2.2** — target size, focus appearance, and dragging movements are the relevant criteria.
Treat them as a floor, not a target; this population needs more than the minimum.

**Switch access patterns** — how scanning actually works: row-column, group, auto versus step,
and what timing is humane. Apple's Switch Control and Android's Switch Access are the reference
implementations to study.
