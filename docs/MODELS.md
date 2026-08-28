# Models

## Install

```bash
npm run fetch:models          # ASR + TTS + VAD, ~264 MB
npm run fetch:models -- asr   # just one
npm run fetch:models -- --list
```

Archives are pinned Sherpa-ONNX release artefacts, extracted into
`public/models/{asr,tts,vad}` and flattened so the served layout is
`/models/asr/sherpa-onnx-wasm-main-asr.js`. Set `SHERPA_VERSION` to pin a
different release.

| Bundle | Release | Size | Contents |
| --- | --- | --- | --- |
| `asr` | v1.13.6 | ~167 MB | Streaming English Zipformer transducer |
| `tts` | v1.12.37 | ~81 MB | Piper VITS English (US), multi-speaker |
| `vad` | v1.13.6 | ~3 MB | Silero voice activity detection |

Each bundle pins its own release, because they do not all ship in every one —
and because the newest is not always the one that works. See below.

## Without them

The application runs. Composition, the phrase board, expansion, prediction,
calls and Real-Time Text all work, and synthesis falls back to the platform
voice. Only dictation is unavailable, and the status bar says
**Listening: unavailable** rather than failing obscurely.

The one consequence worth knowing: the platform voice cannot be transmitted on a
call. `speechSynthesis` renders to the OS mixer, outside any graph we can reach,
so a remote partner sees your text but hears nothing. Installing the TTS bundle
fixes that.

## Serving from elsewhere

```bash
VITE_SHERPA_ASR_BASE=https://models.example.org/asr-v1.13.6
VITE_SHERPA_TTS_BASE=https://models.example.org/tts-v1.12.37
```

A third-party origin interacts with cross-origin isolation. Under
`Cross-Origin-Embedder-Policy: require-corp` — the specification's mandate and
the default — every cross-origin subresource must send
`Cross-Origin-Resource-Policy: cross-origin` or a matching CORS response. If
your CDN will not, run the origin with `COEP_MODE=credentialless`: it still
yields `crossOriginIsolated === true` and therefore `SharedArrayBuffer`, while
permitting no-cors cross-origin loads. Check the **Diagnostics** panel after
changing this; if isolation is lost, inference silently drops to one thread and
audio starts stuttering under load.

Whichever origin serves them, apply:

```
Cache-Control: public, max-age=31536000, immutable
```

and do **not** compress `.onnx` or `.data`. They are dense float matrices —
compression gains almost nothing and costs CPU on every edge node.

## Bundle layout

The workers expect the standard Sherpa release layout:

```
models/asr-v1.13.6/
├── sherpa-onnx-asr.js              helper — defines createOnlineRecognizer
├── sherpa-onnx-wasm-main-asr.js    Emscripten glue
├── sherpa-onnx-wasm-main-asr.wasm
└── sherpa-onnx-wasm-main-asr.data  packaged model weights
```

The workers pre-define a global `Module` with `locateFile`, then `importScripts`
the helper and the glue in that order. Called with no configuration,
`createOnlineRecognizer(Module)` uses the paths baked into the `.data` archive,
which is why a stock release bundle works with no wiring.

If a bundle uses different filenames, override them when constructing the
provider:

```ts
new SherpaOnnxAsrProvider({
  base: '/models/asr',
  entries: { helper: 'my-helper.js', glue: 'my-glue.js', factory: 'createOnlineRecognizer' },
});
```

## Which bundles work, and why these

Three upstream traps, all of which cost real debugging time and all of which are
handled in code so they do not have to again.

**Not every TTS model can speak on demand.** The newest releases ship
`pocket-tts` and `zipvoice` in place of Piper. Both are *voice cloning* models:
they derive a voice embedding from a reference recording, and asking them simply
to say a sentence fails with `reference_sample_rate 0 is invalid`. An AAC device
needs a voice that works the moment it loads, so the pinned bundle is Piper
VITS, where `sid` selects one of the LibriTTS-R speakers.

(Voice cloning is genuinely interesting here — someone with a degenerative
condition could bank their own voice while they still have it — but it is a
different feature, needing reference audio capture and consent handling.)

**From v1.13 the TTS glue is built with `-sEXPORT_ES6=1` and pthreads.** That
build stalls forever during nested pthread bootstrap: the bundle's own demo page
hangs at `Downloading data... 100%` with no error and no console output. The
pinned v1.12.37 build is the classic single-threaded one, the same shape the ASR
bundle still uses. `src/speech/bundleShape.ts` detects which shape a bundle is
and loads it accordingly, so a future move to the module build will work — but
the pinned release is the one verified to run.

**The helper's default model path does not always match the archive.** The Piper
bundle packages `/en_US-libritts_r-medium.onnx`, while the helper's VITS default
asks for `./model.onnx`; the runtime then fails validation with
`--vits-model: './model.onnx' does not exist`, and again the bundle's own demo
fails identically. So the loader reads the packaged file manifest out of the
glue and passes a configuration matching what is actually there, rather than
trusting the default.

## Choosing a different model

Any Sherpa-ONNX WASM ASR bundle works. `--list` shows the defaults; the
[release page](https://github.com/k2-fsa/sherpa-onnx/releases) has multilingual
Zipformer and Paraformer variants.

Streaming transducers give partial hypotheses as you speak, which is what makes
dictation feel usable. Offline models (SenseVoice, Whisper class) are more
accurate and punctuate better but only produce output at the end of an
utterance. To use one, pass `mode: 'offline'` and an explicit model
configuration — the offline recogniser has no baked-in defaults.

## Two-pass recognition

The specification describes streaming for immediate feedback plus an
asynchronous offline pass to restore punctuation. Set
`VITE_SHERPA_REFINE_BASE` to a second bundle to enable it.

Unset, `restorePunctuation()` handles casing and terminal punctuation with
rules. It is cosmetic — applied to display and to synthesis input, never to the
text used for matching — but it is not merely decorative: a synthesiser reads an
unpunctuated sentence as one flat breath, which is markedly harder to follow.

## Offline caching

The service worker runtime-caches anything under `/models/` `CacheFirst` with a
one-year expiry and range-request support. Models are never *pre*-cached: an
install-time waterfall of hundreds of megabytes would be hostile. They are
cached on first use, after which the device works with the network severed.
