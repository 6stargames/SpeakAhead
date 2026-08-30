/**
 * Inspect a Sherpa-ONNX WebAssembly bundle before loading it.
 *
 * Two questions have to be answered from outside the worker, because both
 * decisions are made at worker-construction time.
 *
 * **Which module shape?** Sherpa ships two incompatible layouts with nothing in
 * the filenames to tell them apart:
 *
 *   classic  helper and Emscripten glue are plain scripts reading a global
 *            `Module`, loaded with `importScripts` from a classic worker.
 *   module   built with `-sEXPORT_ES6=1` - the glue is an ES module whose
 *            default export is an async factory, loaded with dynamic `import`.
 *
 * Guessing wrong gives `importScripts: Unexpected token 'export'`, which reads
 * like a corrupt download rather than a build-variant mismatch.
 *
 * **Which files does it actually package?** The helper hardcodes default model
 * paths per model type, and those defaults do not always match what the archive
 * contains. The Piper English bundle packages `/en_US-libritts_r-medium.onnx`
 * while the helper asks for `./model.onnx`, so the runtime fails validation with
 * `--vits-model: './model.onnx' does not exist` - and the bundle's own demo page
 * fails the same way. Reading the manifest lets us pass a config that matches
 * the archive instead of trusting a default that does not.
 *
 * Both answers come from one fetch of the glue, which the browser then serves
 * from cache when the worker loads it for real.
 */

export interface BundleInspection {
  /** True when the bundle must be loaded as an ES module. */
  readonly moduleBundle: boolean;
  /** Absolute paths inside the packaged virtual filesystem, e.g. `/tokens.txt`. */
  readonly files: readonly string[];
}

const cache = new Map<string, Promise<BundleInspection>>();

const MODULE_MARKERS = /(^|[\s;}])export\s*(\{|default\b|const\b|function\b|class\b|let\b|var\b)/m;
const PACKAGED_FILE = /"filename"\s*:\s*"([^"]+)"/g;

async function inspect(url: string): Promise<BundleInspection> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read ${url}: HTTP ${response.status}`);
  const source = await response.text();

  const files: string[] = [];
  for (const match of source.matchAll(PACKAGED_FILE)) {
    if (match[1]) files.push(match[1]);
  }

  return { moduleBundle: MODULE_MARKERS.test(source), files };
}

export function inspectBundle(base: string, glueFile: string): Promise<BundleInspection> {
  const url = `${base}/${glueFile}`;
  let pending = cache.get(url);
  if (!pending) {
    pending = inspect(url).catch((error: unknown) => {
      // A failed probe must not stop the load: the worker will produce a more
      // specific error than this could.
      console.info(`[aac] Could not inspect ${url}; assuming a classic bundle.`, error);
      return { moduleBundle: false, files: [] } satisfies BundleInspection;
    });
    cache.set(url, pending);
  }
  return pending;
}

export async function isModuleBundle(base: string, glueFile: string): Promise<boolean> {
  return (await inspectBundle(base, glueFile)).moduleBundle;
}

export function clearBundleShapeCache(): void {
  cache.clear();
}

/** `/espeak-ng-data/af_dict` → true; `/tokens.txt` → false. */
function isAtRoot(path: string): boolean {
  return /^\/[^/]+$/.test(path);
}

/**
 * Build a VITS model configuration matching what the archive actually contains.
 *
 * Returns `undefined` when the helper's own defaults will do - either the
 * bundle packages `model.onnx` as expected, or it is not a single-model VITS
 * bundle and guessing would be worse than letting the helper decide.
 */
export function deriveVitsConfig(files: readonly string[]): Record<string, unknown> | undefined {
  if (files.length === 0) return undefined;

  const rootModels = files.filter((path) => isAtRoot(path) && path.endsWith('.onnx'));
  // Exactly one model at the root is the VITS shape. Zero means another
  // architecture; more than one means the helper's per-type defaults know
  // better than a guess would.
  if (rootModels.length !== 1) return undefined;

  const model = rootModels[0] as string;
  if (model === '/model.onnx') return undefined;

  const tokens = files.find((path) => path === '/tokens.txt');
  const hasEspeak = files.some((path) => path.startsWith('/espeak-ng-data/'));
  const lexicon = files.find((path) => path === '/lexicon.txt');

  return {
    offlineTtsModelConfig: {
      offlineTtsVitsModelConfig: {
        model: `.${model}`,
        tokens: tokens ? `.${tokens}` : '',
        lexicon: lexicon ? `.${lexicon}` : '',
        dataDir: hasEspeak ? './espeak-ng-data' : '',
        noiseScale: 0.667,
        noiseScaleW: 0.8,
        lengthScale: 1.0,
      },
      numThreads: 1,
      provider: 'cpu',
      debug: 1,
    },
    ruleFsts: '',
    ruleFars: '',
    maxNumSentences: 1,
  };
}
