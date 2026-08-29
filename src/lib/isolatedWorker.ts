/**
 * Start a worker from a same-origin blob bootstrap.
 *
 * A cross-origin-isolated document requires its worker's initial response to
 * carry COEP. Some static hosts do not apply application headers to assets,
 * even though they apply them to the document. A blob worker inherits the
 * document's isolated agent cluster; it can then import the real, trusted
 * worker script as a normal subresource.
 */
export function createIsolatedWorker(
  scriptUrl: string,
  type: 'classic' | 'module',
): Worker {
  const absoluteScriptUrl = new URL(scriptUrl, globalThis.location.href).href;
  const bootstrap = type === 'module'
    ? `import ${JSON.stringify(absoluteScriptUrl)};`
    : `importScripts(${JSON.stringify(absoluteScriptUrl)});`;
  const bootstrapUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));

  try {
    const worker = new Worker(bootstrapUrl, { type });
    const releaseBootstrap = () => URL.revokeObjectURL(bootstrapUrl);
    worker.addEventListener('message', releaseBootstrap, { once: true });
    worker.addEventListener('error', releaseBootstrap, { once: true });
    return worker;
  } catch (error) {
    URL.revokeObjectURL(bootstrapUrl);
    throw error;
  }
}
