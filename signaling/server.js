/**
 * Standalone regional signalling server.
 *
 * The specification calls for this to sit in a Midwest data centre —
 * us-east-2 (Ohio) or us-central1 (Iowa) — so that call setup for users around
 * Chicago stays inside a short round trip. Deploy it separately from the
 * application origin and point the client at it with VITE_SIGNALING_URL.
 *
 * The same hub also runs inside the application's own server.js, so this is
 * only needed when the origin and the signalling plane are deployed apart.
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createRedisBroadcaster, SignalingHub } from './hub.js';

const PORT = Number(process.env.PORT) || 8081;
const HOST = process.env.HOST || '0.0.0.0';
const PATH = process.env.SIGNAL_PATH || '/signal';

/** Comma-separated list; empty means allow any origin. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const hub = new SignalingHub();

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        status: 'ok',
        rooms: hub.roomCount,
        peers: hub.peerCount,
        uptimeSeconds: Math.round(process.uptime()),
      }),
    );
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('This endpoint only speaks WebSocket. Connect to ' + PATH + '.');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
hub.startHeartbeat(wss);
wss.on('connection', (socket) => hub.handleConnection(socket));

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (pathname !== PATH) {
    socket.destroy();
    return;
  }

  const origin = request.headers.origin;
  if (ALLOWED_ORIGINS.length > 0 && (!origin || !ALLOWED_ORIGINS.includes(origin))) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

const broadcaster = await createRedisBroadcaster(process.env.REDIS_URL, hub);
if (broadcaster) hub.setBroadcaster(broadcaster);

server.listen(PORT, HOST, () => {
  console.log(`[signal] Listening on ws://${HOST}:${PORT}${PATH}`);
  if (ALLOWED_ORIGINS.length > 0) console.log(`[signal] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
