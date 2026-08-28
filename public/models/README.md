# Model weights

This directory is intentionally empty in version control.

The Sherpa-ONNX WebAssembly bundles are hundreds of megabytes of dense float
matrices. They compress poorly, they change on their own release cadence, and
they would make every clone of this repository unusable.

Install them with:

```bash
npm run fetch:models
```

That downloads pinned release artefacts from the Sherpa-ONNX project and lays
them out as:

```
public/models/
├── asr/    streaming English Zipformer transducer
├── tts/    neural English synthesis
└── vad/    Silero voice activity detection
```

To serve them from somewhere else — a CDN, a shared internal host — set
`VITE_SHERPA_ASR_BASE`, `VITE_SHERPA_TTS_BASE` and `VITE_SHERPA_VAD_BASE`
instead. See [docs/MODELS.md](../../docs/MODELS.md) for details, including the
`Cross-Origin-Embedder-Policy` implications of a third-party origin.

Without these files the application still runs: composition, the phrase board,
the WebMCP tools, calls and Real-Time Text all work, and synthesis falls back to
the platform voice. Only dictation is unavailable, and the interface says so.
