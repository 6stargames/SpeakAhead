# WebMCP for a Talking Device

**Research brief · Internship project**

We have built the hard parts. Now we want to know what an AI agent should actually be allowed to
do inside a device that speaks on someone's behalf.

| | |
| --- | --- |
| **For** | Research intern |
| **Output** | Written recommendations, ranked |
| **Effort** | Roughly one week |
| **Prerequisites** | None — this brief is self-contained |

---

## What the product is

We build an **AAC device** — augmentative and alternative communication. It is software for people
who cannot reliably speak: after a stroke, with cerebral palsy, with motor neurone disease, with
severe dysarthria. The person types or selects words, and the device says them out loud in a
synthesised voice.

Ours runs entirely in a browser. It transcribes the room so the user can see what was said to
them, it synthesises their replies, and it can place a call where the synthesised voice is carried
to the other person alongside real-time text.

The number that matters is **communication rate**. An unaided AAC user often manages fewer than 15
words per minute against roughly 150 for speech. That gap is the product. Every design decision
either closes it or does not.

> **The thing to hold on to throughout this research:** this device is a person's voice. Not a chat
> interface, not a productivity tool. When it speaks, everyone in the room believes the user said
> it.
>
> That makes agent assistance unusually valuable — the user is slow and the agent is fast — and
> unusually dangerous, because a user who cannot speak quickly also cannot quickly retract
> something said in their name.

---

## What WebMCP is, and why we care

Historically, an AI agent operating a website had to guess: parse the DOM, read a screenshot, click
something that looked like a button. **WebMCP** replaces the guessing with a contract. A page calls
`registerTool` to declare a named capability with a JSON schema, and an agent in the browser can
discover and call it directly.

It is genuinely experimental. The API has been moving — it began on `document.modelContext` with a
`call` member and a `parameters` schema, and has been migrating toward `navigator.modelContext`
with `execute` and `inputSchema`. Our implementation accepts both and degrades to a no-op where
neither exists. **Assume anything you read may be out of date and check it against a primary
source.**

For us the appeal is specific. Prediction is the single biggest lever on communication rate, and an
agent that can read the conversation and propose what to say next is worth more here than almost
anywhere else it could be deployed.

---

## What we already expose

Five tools are registered today. Each is bound to an `AbortController` so it unregisters cleanly,
and each is reachable by an on-device fallback when no agent is present.

| Tool | What it does |
| --- | --- |
| `get-conversation-context` | Returns the last ten turns, who said each one, and what the user is currently composing. |
| `predict-conversational-phrase` | Agent supplies three likely replies; they appear as one-tap buttons. |
| `expand-semantic-shorthand` | Turns keywords into a sentence. "water cold please" becomes "I would like some cold water, please." |
| `set-composition-buffer` | Places text in the message box for the user to review. Does not speak it. |
| `speak-text` | The one consequential tool. By default it *stages* a sentence for one-tap confirmation rather than speaking. |

### The rest of the stack, in one paragraph

Speech recognition and synthesis both run on-device in WebAssembly, so no audio ever leaves the
browser. Calls use WebRTC, where the only audio transmitted is the synthesised voice — never the
microphone. Voices in the room are separated by pitch so the transcript can label who said what.
When no agent is attached, prediction falls back to the browser's built-in on-device language
model, and then to a deterministic rule engine, so the device is never worse than useful offline.

---

## Constraints your ideas must survive

These are not preferences. An idea that violates one of them is not a trade-off we will consider,
so checking against this list first will save you time.

**Voice audio never leaves the device.** Under the Illinois Biometric Information Privacy Act a
voiceprint is a protected biometric identifier, and our users' recordings are unusually
identifying. Recognition happens locally. Any proposal that sends microphone audio to a server is
out.

**The agent does not speak unprompted.** Agent-authored speech is staged for a confirming tap by
default. A faster path exists behind an explicit setting, chosen by the user. Proposals that assume
the agent can simply talk need to argue that case, not skip it.

**It works with the network severed.** Hospitals and school districts have poor connectivity, and
this is the user's only means of communicating. Anything that only works online must degrade to
something useful, not to nothing.

**Every interaction is reachable.** Users may have limited fine motor control and may use a screen
reader or switch access. An idea that needs precise pointing, fast reactions, or reading a wall of
text is not usable by the people this is for.

---

## Questions we want answered

Work through as many as you can, in order. Depth on four beats a paragraph on all seven. Where you
cannot find evidence, say so — "I looked and found nothing" is a real finding and we would rather
have it than a confident guess.

### 01 · What should we expose that we do not?

Our five tools cover reading context and proposing text. What else would an agent need to be
genuinely useful to someone communicating at 15 words per minute? Think about what happens before
and after a sentence: preparing for an appointment, recovering from a misrecognition, managing a
conversation with three people in the room.

*What good looks like:* a handful of concrete tool proposals, each with a name, a rough schema, and
one sentence on the situation it rescues.

### 02 · How should a tool be described so an agent uses it correctly?

A tool description is a prompt. It decides whether an agent reaches for the right tool at the right
moment, or calls the wrong one confidently. Is there published guidance or measured evidence on
what makes tool descriptions work — naming, length, worked examples, when to say what *not* to do?

*What good looks like:* rules of thumb with sources, then a rewrite of two of our existing
descriptions showing what you would change and why.

### 03 · What is in the spec that we are not using?

We only use tool registration. Read the current specification and Chrome's documentation and
inventory what else exists — other primitives, lifecycle hooks, ways for a page to describe state
rather than actions. Tell us what is real today, what is proposed, and what has already been
dropped.

*What good looks like:* a table of capabilities with status, browser support, and a one-line note
on whether it is worth anything to us.

### 04 · How should the agent know when to act?

Today we predict when the conversation partner finishes speaking. That is a guess. Should the page
signal that a moment is opportune, and is there a mechanism for that? What are the failure modes of
an agent that acts too often — and what does interrupting someone who is mid-sentence cost when
composing a sentence takes them a minute?

*What good looks like:* two or three trigger models with the trade-offs named, and a
recommendation.

### 05 · What consent patterns exist for consequential agent actions?

We stage speech for confirmation. It is a reasonable guess, not a researched decision. Find prior
art — in assistive technology, in medical device interfaces, in agent products generally — for
letting an agent act on someone's behalf when the action cannot be taken back. What has been tried,
and what went wrong?

*What good looks like:* three or four patterns described concretely, with an argument for which
suits a device that speaks for its user.

### 06 · How would we know if any of this actually helps?

Communication rate is the metric, but measuring it means experimenting on disabled people during
real conversations. What does the AAC research literature say about whether word and phrase
prediction improves rate in practice — the finding is less obvious than it sounds — and how have
those studies handled the ethics?

*What good looks like:* a short summary of what the evidence actually shows, and a proposal for how
we could evaluate a change without harming anyone.

### 07 · Who else is building for agents, and what did they learn?

Scan for other sites and applications exposing agent tools. What are they exposing, how are they
describing it, and has anyone written up what did not work? Assistive technology specifically is a
bonus, but any well-documented implementation is useful.

*What good looks like:* five to ten examples with links, and a short note on anything we should
copy or avoid.

---

## What to hand back

A written document. No slides, no prototype — we want your reasoning, and reasoning is easier to
argue with in prose.

- **A ranked shortlist** of your strongest recommendations at the top, most valuable first. If we
  only read the first page, it should be the page worth reading.
- **One section per question** you tackled, with sources linked inline. Say plainly when something
  is your own inference rather than something you found.
- **For each recommendation:** what it is, why it helps *this* user rather than users in general,
  roughly what it would cost us to build, and how confident you are.
- **A list of what you rejected** and why. Ideas that fail our constraints are worth recording so
  nobody proposes them again in six months.

### Two things that will make this good rather than fine

Use the live app before you write anything. Turn on dictation, have someone else speak, place a
call, open the Diagnostics tab and watch what it reports. The failure modes are much easier to see
than to describe, and the Diagnostics panel exposes most of the machinery.

And treat "we should not do this" as a valid conclusion. We have already talked ourselves out of
several plausible features on consent grounds. If the honest answer to a question is that agents
cannot help here yet, that is worth knowing early.

---

## Where to look

These are entry points, not a reading list. Follow what is useful and ignore what is not.

**The live application** — runs in any Chromium browser. Allow the microphone when asked; the first
load downloads around 300 MB of speech models and then works offline.
<https://webmcpaac--vpx4900.us-east4.hosted.app/>

**Our source code** — the WebMCP integration is in `src/webmcp/`. Start with `tools.ts` for the tool
definitions and `useWebMCPTool.ts` for the registration lifecycle. The `docs/` folder explains the
privacy and accessibility constraints in more depth than this brief does.
<https://github.com/6stargames/webmcp_AAC>

**Chrome's WebMCP documentation** — the most current description of the imperative API. Check the
dates on anything you find here; this has changed more than once.
<https://developer.chrome.com/docs/ai/webmcp>

**Model Context Protocol** — WebMCP borrows its vocabulary from MCP. The parent protocol has
primitives beyond tools, which is directly relevant to question 03.
<https://modelcontextprotocol.io>

**AAC research literature** — for question 06. The journal *Augmentative and Alternative
Communication* is the main venue; search terms worth trying include "rate enhancement", "word
prediction", and "communication rate". Much of it predates language models, which is itself
interesting.

**W3C RTC Accessibility User Requirements** — the accessibility standard our call handling is built
against. Useful background on why the audio routing is arranged the way it is.
<https://www.w3.org/TR/raur/>
