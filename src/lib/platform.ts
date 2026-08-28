export interface PlatformCapabilities {
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly hardwareConcurrency: number;
  readonly audioWorklet: boolean;
  readonly webAssembly: boolean;
  readonly webAssemblyThreads: boolean;
  readonly webRtc: boolean;
  readonly mediaDevices: boolean;
  readonly serviceWorker: boolean;
  readonly secureContext: boolean;
}

/**
 * The environment self-test the specification asks an engineer to perform by
 * hand in the console (`typeof SharedArrayBuffer`).
 *
 * Automating it is worth the few lines: cross-origin isolation is easy to lose
 * to a misconfigured CDN or a proxy that strips headers, and the failure is
 * silent — the ONNX runtime just quietly single-threads and the audio starts
 * stuttering under load. Better to state it plainly on screen.
 */
export function detectPlatform(): PlatformCapabilities {
  const scope = globalThis as unknown as {
    crossOriginIsolated?: boolean;
    SharedArrayBuffer?: unknown;
    isSecureContext?: boolean;
  };

  let webAssemblyThreads = false;
  try {
    // Constructing a shared WebAssembly.Memory is the definitive test: it
    // throws where the threads proposal is unavailable, and it also fails
    // without cross-origin isolation, which is exactly the condition that
    // matters for multi-threaded inference.
    webAssemblyThreads =
      typeof WebAssembly !== 'undefined' &&
      new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof SharedArrayBuffer;
  } catch {
    webAssemblyThreads = false;
  }

  return {
    crossOriginIsolated: scope.crossOriginIsolated === true,
    sharedArrayBuffer: typeof scope.SharedArrayBuffer === 'function',
    hardwareConcurrency: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 1) : 1,
    audioWorklet: typeof AudioWorkletNode !== 'undefined',
    webAssembly: typeof WebAssembly !== 'undefined',
    webAssemblyThreads,
    webRtc: typeof RTCPeerConnection !== 'undefined',
    mediaDevices: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    secureContext: scope.isSecureContext === true,
  };
}

/** Threads the ONNX runtime can realistically use, given isolation status. */
export function usableThreadCount(capabilities: PlatformCapabilities): number {
  if (!capabilities.crossOriginIsolated || !capabilities.sharedArrayBuffer) return 1;
  return Math.max(1, Math.min(4, Math.floor(capabilities.hardwareConcurrency / 2)));
}
