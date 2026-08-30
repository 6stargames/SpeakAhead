/**
 * Production origin for the Context-Aware AAC application.
 *
 * Three jobs:
 *   1. Serve the built client with the Cross-Origin Isolation headers the
 *      WebAssembly speech engines need in order to use more than one thread.
 *   2. Apply the specification's asset policy — Brotli for text and WASM,
 *      never for ONNX weights, immutable caching for both.
 *   3. Host the WebRTC signalling WebSocket, so a single container is a
 *      complete deployment.
 *
 * Zero framework dependencies beyond `ws`: fewer moving parts on the one
 * process that has to stay up.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { cacheControl, etagFor, IMMUTABLE_EXTENSIONS } from './http-cache.js';
import { createIceServerResolver } from './ice-servers.js';
import { createRedisBroadcaster, SignalingHub } from './signaling/hub.js';
import { HttpSignalingHub, readJsonBody } from './signaling/http-hub.js';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** Vite output in production; the raw public directory in development. */
const DIST_DIR = resolve(ROOT, 'dist');
const PUBLIC_DIR = resolve(ROOT, 'public');
const SERVE_DIR = existsSync(DIST_DIR) ? DIST_DIR : PUBLIC_DIR;

/**
 * `require-corp` is the specification's mandate and the default. Deployments
 * that pull model weights from a third-party CDN need `credentialless`, which
 * still grants SharedArrayBuffer but permits no-cors cross-origin loads.
 */
const COEP_MODE = process.env.COEP_MODE === 'credentialless' ? 'credentialless' : 'require-corp';
const ENABLE_SIGNALING = process.env.ENABLE_SIGNALING !== 'false';

const iceResolver = createIceServerResolver(process.env);

/**
 * HTTP signalling, because this origin cannot use WebSockets.
 *
 * Firebase App Hosting's edge answers a valid WebSocket handshake with 403
 * before the request reaches this process — for every path, including ones this
 * server would reject itself. Plain HTTP passes through untouched.
 */
const httpSignaling = new HttpSignalingHub();

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  // Without the correct type the browser refuses to stream-compile the module.
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.ort': 'application/octet-stream',
};

/** Paths that must never resolve to the single-page shell. */
const RESERVED_PREFIXES = ['/api', '/signal', '/healthz'];

function isolationHeaders() {
  return {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': COEP_MODE,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // No microphone audio ever leaves the page, but a Permissions-Policy makes
    // that a browser-enforced property rather than a claim in a document.
    'Permissions-Policy': 'camera=(), display-capture=(self), geolocation=(), payment=(), usb=(), microphone=(self)',
  };
}


/**
 * Prefer a pre-compressed sibling when the client accepts it.
 *
 * `scripts/precompress.mjs` deliberately does not compress `.onnx`/`.data`:
 * they are dense float matrices that do not shrink, and compressing them only
 * burns CPU and delays first audio.
 */
function negotiateEncoding(filePath, acceptEncoding) {
  const accepts = String(acceptEncoding ?? '');
  const candidates = [];
  if (/\bbr\b/.test(accepts)) candidates.push(['.br', 'br']);
  if (/\bgzip\b/.test(accepts)) candidates.push(['.gz', 'gzip']);

  for (const [suffix, encoding] of candidates) {
    const candidate = `${filePath}${suffix}`;
    if (existsSync(candidate)) {
      return { path: candidate, encoding, size: statSync(candidate).size };
    }
  }
  return null;
}

async function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  let filePath = resolve(SERVE_DIR, `.${decoded}`);
  if (filePath !== SERVE_DIR && !filePath.startsWith(SERVE_DIR + sep)) return null;

  let info = await stat(filePath).catch(() => null);
  if (info?.isDirectory()) {
    filePath = join(filePath, 'index.html');
    info = await stat(filePath).catch(() => null);
  }
  return info?.isFile() ? { path: filePath, size: info.size, mtime: info.mtimeMs } : null;
}

function sendPlain(res, status, body) {
  res.writeHead(status, {
    ...isolationHeaders(),
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendJson(res, status, payload, cacheControl = 'no-store') {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...isolationHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** @returns true when the request was handled here. */
async function handleSignaling(req, res, pathname, url) {
  if (!ENABLE_SIGNALING) {
    sendJson(res, 503, { error: 'signalling_disabled' });
    return true;
  }

  try {
    switch (pathname) {
      case '/api/signal/join': {
        const { room, peerId } = await readJsonBody(req);
        const result = httpSignaling.join(room, peerId);
        sendJson(res, result.ok ? 200 : 400, result);
        return true;
      }

      case '/api/signal/send': {
        const { room, from, to, payload } = await readJsonBody(req);
        const result = httpSignaling.send(room, from, to, payload);
        sendJson(res, result.ok ? 200 : 400, result);
        return true;
      }

      case '/api/signal/leave': {
        const { room, peerId } = await readJsonBody(req);
        sendJson(res, 200, httpSignaling.leave(room, peerId));
        return true;
      }

      case '/api/signal/poll': {
        const room = url.searchParams.get('room');
        const peerId = url.searchParams.get('peerId');
        // Held open until a message arrives or the poll times out. The response
        // always completes normally, so no proxy in the path can buffer it.
        const result = await httpSignaling.poll(room, peerId);
        sendJson(res, result.ok ? 200 : 409, result);
        return true;
      }

      default:
        return false;
    }
  } catch (error) {
    sendJson(res, 400, { error: 'bad_request', detail: error?.message ?? String(error) });
    return true;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const { pathname } = url;

  if (pathname.startsWith('/api/signal/')) {
    const expected = pathname === '/api/signal/poll' ? 'GET' : 'POST';
    if (req.method !== expected) {
      res.writeHead(405, { ...isolationHeaders(), Allow: expected });
      res.end();
      return;
    }
    if (await handleSignaling(req, res, pathname, url)) return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...isolationHeaders(), Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  // TURN credentials are minted here, per request, and never inlined into the
  // client bundle. See ice-servers.js.
  if (pathname === '/api/ice-servers') {
    const result = await iceResolver.resolve();
    const maxAge = Math.max(60, Math.floor((result.expiresAt - Date.now()) / 1000) - 300);
    const body = JSON.stringify({
      iceServers: result.iceServers,
      provider: result.provider,
      expiresAt: result.expiresAt,
      ...(result.degraded ? { degraded: true, detail: result.detail } : {}),
    });

    res.writeHead(200, {
      ...isolationHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      // Private: the credentials are short-lived and specific to this response.
      'Cache-Control': `private, max-age=${maxAge}`,
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  // App Hosting's edge intercepts /healthz for its own probing, so the alias is
  // what is actually reachable from outside.
  /**
   * Which asset the current build's shell references.
   *
   * Deliberately under /api, where no service worker route matches: a page must
   * be able to ask the origin what the current build is without its own cache
   * answering on the origin's behalf. That is the whole point — a stale worker
   * will happily insist it is up to date.
   */
  if (pathname === '/api/build') {
    const shell = await readFile(resolve(SERVE_DIR, 'index.html'), 'utf8').catch(() => '');
    sendJson(res, 200, { asset: /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(shell)?.[0] ?? null });
    return;
  }

  if (pathname === '/healthz' || pathname === '/api/health') {
    const body = JSON.stringify({
      status: 'ok',
      serving: SERVE_DIR === DIST_DIR ? 'dist' : 'public',
      coep: COEP_MODE,
      signaling: ENABLE_SIGNALING,
      signalingTransport: 'http-long-poll',
      turn: iceResolver.provider,
      signalRooms: httpSignaling.roomCount,
      signalPeers: httpSignaling.peerCount,
      rooms: hub.roomCount,
      peers: hub.peerCount,
      uptimeSeconds: Math.round(process.uptime()),
    });
    res.writeHead(200, {
      ...isolationHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  // An unknown endpoint under a reserved prefix must not fall through to the
  // single-page shell. Returning index.html with a 200 for a mistyped API path
  // turns "this route does not exist" into "the JSON parser blew up", which
  // costs an afternoon to trace back.
  if (RESERVED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    const body = JSON.stringify({ error: 'not_found', path: pathname });
    res.writeHead(404, {
      ...isolationHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  let file = await resolveFile(pathname);

  // Single-page fallback for routes without a file extension. Paths that look
  // like assets must still 404, or a typo in a model URL returns HTML and the
  // WebAssembly loader fails with something incomprehensible.
  if (!file && extname(pathname) === '') {
    file = await resolveFile('/index.html');
  }

  if (!file) {
    sendPlain(res, 404, 'Not Found');
    return;
  }

  const encoded = negotiateEncoding(file.path, req.headers['accept-encoding']);
  const encodingName = encoded?.encoding ?? 'identity';
  const caching = cacheControl(file.path);

  // The ETag must identify the *representation*, not just the file: a client
  // holding the Brotli body and later asking without `Accept-Encoding: br`
  // would otherwise get a 304 for a body it cannot decode.
  //
  // Revalidated resources are hashed by content; immutable ones already carry
  // a hash in their URL, so size and mtime are enough for them.
  const etag = await etagFor(file.path, {
    size: file.size,
    mtimeMs: file.mtime,
    encoding: encodingName,
    servedPath: encoded ? encoded.path : file.path,
  });

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, {
      ...isolationHeaders(),
      ETag: etag,
      'Cache-Control': caching,
      Vary: 'Accept-Encoding',
    });
    res.end();
    return;
  }

  const extension = extname(file.path).toLowerCase();

  const headers = {
    ...isolationHeaders(),
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'Cache-Control': caching,
    ETag: etag,
    Vary: 'Accept-Encoding',
    'Content-Length': encoded ? encoded.size : file.size,
  };
  if (encoded) headers['Content-Encoding'] = encoded.encoding;

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(encoded ? encoded.path : file.path);
  stream.on('error', () => {
    res.destroy();
  });
  stream.pipe(res);
});

// ---------------------------------------------------------------------------
// Signalling
// ---------------------------------------------------------------------------

const hub = new SignalingHub();

if (ENABLE_SIGNALING) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  hub.startHeartbeat(wss);

  wss.on('connection', (socket) => hub.handleConnection(socket));

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (pathname !== '/signal') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  const broadcaster = await createRedisBroadcaster(process.env.REDIS_URL, hub);
  if (broadcaster) hub.setBroadcaster(broadcaster);
}

server.listen(PORT, HOST, () => {
  console.log(`[aac] Serving ${SERVE_DIR} on http://${HOST}:${PORT}`);
  console.log(`[aac] Cross-Origin-Embedder-Policy: ${COEP_MODE}`);
  console.log(`[aac] Signalling: ${ENABLE_SIGNALING ? 'ws://…/signal' : 'disabled'}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[aac] ${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
