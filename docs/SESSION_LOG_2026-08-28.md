# Session log — 2026-08-28

Everything done and learned in one long working day, written down before the
conversation context is compacted. Thirty-plus commits landed on `main`; each
one was verified (typecheck, 320 tests, BIPA egress audit, and live browser
checks where observable) and deployed via App Hosting's rebuild-on-push.

**Standing instruction:** after completing and verifying a change in this
repo, commit and push to `main` without asking (recorded in Claude's memory).

---

## 1. Where the product stands

### Layout (all views)

- Output ribbon on top: message box (placeholder shows the full app name for
  4s on load — there is no title bar any more), **Speak**, **⌫ Word**
  (delete last word), **Clear**, and **Restore last** after a Speak.
- **Chat is always on screen** (left column, newest-first, follow-the-top
  scrolling). Header: "CHAT", inline stats for the two most talkative
  speakers (share % · words · voiced time), compact chips `👥 N (+M)` and
  `📞 2` that open a breakdown panel (per-speaker stats, forming voices,
  callee details). Listening bar (voice-note style) and a "Voice getting
  ready" bar sit under the title. Confidence squiggles (wavy warning
  underline) mark words the recogniser scored below 0.5.
- **Call corner** at the chat's bottom-right: code field (12ch) + one button
  (blank = create, typed = join). Creating auto-copies the code with a
  toast; in-call it shows a running clock, the code with ⧉ copy, and End.
- **Spine** (middle): ⭐ Favs, 💬 Phrases, 🔤 Words on top; the emergency
  block (HELP / PAIN / CAN'T BREATHE / OVERRIDE) centred between red rules;
  🎙️ Voice, ⚙️ Settings, and Checks at the foot. The Checks icon is a live
  health light: ✅ ok, ⏳ loading, ❌ hard error.
- **Board area** (right): Core words (36, Fitzgerald-coloured, cells grow
  beyond the 80px floor), Favs (24 fixed slots per folder, caregiver
  editing behind a 3s hold), Phrases, Voice, Settings, Checks.
- Suggestions never appear unprompted (auto-prediction removed). The
  floating suggestion overlay only shows agent-pushed content, mic
  problems, or Checks-simulator output.
- Dark theme is true black (#000 grounds, #0e0e10 raised); high-contrast
  stays yellow-on-black; Fitzgerald colours are a contract everywhere.

### Speech / voice pipeline

- ASR: streaming Zipformer (sherpa-onnx WASM). Final results now carry
  per-token log-probs (`ys_probs`) → per-word confidences
  (`src/speech/confidence.ts`, geometric mean, threshold `UNCERTAIN_BELOW
  = 0.5`), rendered as squiggles.
- **Speaker attribution is neural**: CAM++ speaker-verification network
  (3D-Speaker VoxCeleb English, 29 MB ONNX) via onnxruntime-web in a Web
  Worker (`src/speech/embed/`), fed by a hand-written Kaldi-compatible
  80-bin fbank (`src/speech/fbank.ts`) validated against the real network
  (same voice 0.87 vs different voice 0.58 on synthetics).
- Attribution ladder (`src/speech/speakers.ts`): neural voiceprint >
  MFCC timbre (with room-mean centering) > pitch. Key constants:
  - `NEURAL_CONFIDENT 0.55`, `NEURAL_TEACH 0.7` (matching ≠ teaching),
    `NEURAL_POSSIBLE 0.4`, rolling `NEURAL_HISTORY 16` so profiles heal.
  - Nursery: non-confident prints cluster (`NURSERY_JOIN 0.5`); graduate at
    2 unmatched or 3 shadow members if < `NURSERY_GRADUATE_DISTINCT 0.62`
    vs every profile. Geometry is the safety: same-voice noise deviates
    randomly and never coheres; a real voice deviates consistently.
  - `NEW_VOICE_MIN_FRAMES 12` (~1s voiced) to found outright; ownership is
    never presumed (speech-impaired user ⇒ heard voices are other people;
    "This is me" is the only path to "You").
- **Mid-utterance splitting**: every ~0.5s the open utterance's head
  (~1.5s) is compared to its last ~1s by voiceprint; below
  `CHANGE_SPLIT_BELOW 0.45` the turn is split (run-on fix). Pitch-jump
  detector still runs.
- Junk turns (≤2 words dictated) collapse; dictated-not-spoken turns are
  outlined; the speaker label opens rename / claim / forget in place.
- TTS: Piper VITS libritts_r (904 speakers). **Curated shortlist**
  (`src/speech/tts/curatedVoices.ts`): Elizabeth (582, Elizabeth Klett),
  Amanda (9), Ashley (0, model default), Jessica (1); Mark (546, Mark F.
  Smith), Craig (8), Steven (5), Brett (2). Curation = model speaker map
  (piper config on HF) × LibriSpeech SPEAKERS.TXT (gender/name); Klett and
  Smith are genuinely celebrated LibriVox narrators. Preview via
  `session.previewVoice()` (local only). Full list behind an expander.
- Mic: always dictating. Auto-listen prompts at load; **Chrome's quiet
  permission UI suppresses non-gesture prompts** (incognito!), so the first
  tap/keypress anywhere retries getUserMedia. The listening bar always
  shows a state (listening / getting ready / off—tap to start / blocked).

### Calls

- Signalling: HTTP long-poll to same-origin `/api/signal/*` (App Hosting
  blocks WebSockets). Dev server proxies `/api` → the deployed app
  (`VITE_DEV_API_PROXY` overrides; `npm start` serves it locally on 8080).
- 404 from signalling is terminal with a clear message (was: infinite
  silent retry — the original "nothing happened").
- **Trickle-ICE race fixed**: candidates arriving before the remote
  description are buffered in `PeerSession` and applied after
  `setRemoteDescription` (long-poll batches reorder freely).
- TURN: Cloudflare, credentials minted server-side (`/api/ice-servers`);
  Danny rotated the credentials and the probe confirms relay reachability.
  Network readiness auto-runs at the top of Checks.
- A connected call transmits **typed RTT and the device's spoken output
  only — never the microphone** (BIPA rule #1). The call panel hint and
  this doc both say so, because a "silent" connected call looked broken.

### Access & vocabulary (round-two brief, all shipped)

- Switch scanning (row-column over live DOM, Space/Enter, auto/step,
  2s-hold jumps to emergency), dwell selection (350–1000ms ring, rest
  zone), word-level repair, caregiver editing + progressive masking,
  fringe folders. ARASAAC deliberately deferred (CC BY-NC-SA licence needs
  a product decision; egress audit conflict).
- Settings are all **big press-once option buttons** (named presets replace
  sliders; two-button choices replace checkboxes; voice picker moved to the
  Voice page).

## 2. Hard-won lessons (do not relearn these)

1. **Pitch cannot separate speakers.** One voice's per-utterance median
   spans an octave; two voices share pitch. Every pitch-tuning attempt
   traded one field failure for another. The neural voiceprint fixed it.
2. **Raw embeddings on one channel compress**: everything through the same
   speakers/room/mic scored 0.93–0.97 cross-voice. Room-mean subtraction
   (85%) fixed MFCC; the neural model needs no centering.
3. **Matching ≠ teaching.** Any utterance ≥ match line teaching the profile
   let one 0.56 crossing blend two podcast hosts irreversibly (and the
   blend blocked nursery graduation). Teach at 0.7+; keep a rolling window.
4. **onnxruntime-web**: import `onnxruntime-web/wasm` (the default bundle
   loads jsep/WebGPU runtime files → "no available backend" silently);
   `ort.env.wasm.wasmPaths = { wasm: '/ort/…' }` only (a directory path
   forces an external .mjs fetch Vite won't serve as a module); assets are
   copied to `public/ort/` by `scripts/copy-ort-assets.mjs`
   (postinstall/dev/build).
5. **Model loading must be visible**: the "Voiceprint network" row in
   Checks (loading/ready/error + reason) ended a class of silent-fallback
   confusion; "timbre" instead of "voiceprint" in reasons = network absent.
   Also start the download at boot, not first mic use.
6. **Chrome quiet permission UI** silently blocks non-gesture mic prompts on
   engagement-less origins (incognito). Retry on first user gesture.
7. **Deploys are eventual**: App Hosting rebuilds on push (minutes) and the
   SW updates on prompt — the Build row in Checks answers "which code is
   this tab running". Model host deploys are separate:
   `firebase deploy --only hosting:models` (needs Danny's auth).
8. **Long-poll signalling reorders messages** — buffer ICE candidates until
   the description lands.
9. Vitest + ort-web runs the real ONNX in Node (`tests/speakerModel.test.ts`,
   skipped when models aren't fetched) — calibrate thresholds against the
   actual network, not guesses. Field tuning reads straight from the Checks
   table (every attribution logs its similarity).
10. All 904 libritts_r speakers are `train-clean-360` at ~25 min — subset
    and minutes do not discriminate quality; narrator reputation + model
    ordering was the usable signal.

## 3. Infrastructure notes

- `npm run verify` = typecheck + 320 tests + BIPA egress audit. Run before
  every push. `npm run fetch:models` now also pulls the speaker model
  (`speaker-v1/campplus-en-voxceleb.onnx`).
- Deployed app: https://webmcpaac--vpx4900.us-east4.hosted.app (rebuilds on
  push to main). Models host: webmcp-aac-models.web.app
  (`firebase deploy --only hosting:models`). `VITE_SPEAKER_MODEL_URL` is in
  apphosting.yaml.
- Dev: `npm run dev` (proxies `/api` to prod). Speaker/vocab state is
  session-local; settings/vocab persist in localStorage
  (`aac.settings.v1`, `aac.vocab.v1`).

## 4. Open threads

- **ARASAAC symbol binding** (round-two task 07): blocked on the
  CC BY-NC-SA licence decision and egress-audit reconciliation. Emoji are
  the stand-in.
- **Voice/message banking** (research §08): unstarted.
- **Retroactive relabeling**: turns spoken before a nursery voice graduates
  keep their old label.
- **Threshold tuning**: all speaker constants are field-calibrated once;
  the Checks table is the ongoing data source.
- **Curated voices are unauditioned** by Claude — Danny's ears decide;
  swaps are one-line edits in `curatedVoices.ts`.
- The scanning/dwell paths have unit-tested logic but no end-to-end tests
  with real switch hardware.
- Older docs (design briefs, research reports) live in `docs/` — the
  round-two brief and both research reports remain the design ground truth.
