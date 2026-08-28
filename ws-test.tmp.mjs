import { WebSocket } from 'ws';

const url = process.argv[2];
console.log(`connecting to ${url}`);
const started = Date.now();
const ws = new WebSocket(url);

const done = (msg, code = 0) => { console.log(msg); process.exit(code); };
setTimeout(() => done('TIMEOUT after 15s — no open, no error', 1), 15000);

ws.on('open', () => {
  console.log(`OPEN after ${Date.now() - started}ms`);
  ws.send(JSON.stringify({ t: 'join', room: 'WSTEST-01', peerId: 'probe-1' }));
});
ws.on('message', (d) => { console.log('RECV:', d.toString().slice(0, 200)); ws.close(); done('OK — signalling works'); });
ws.on('error', (e) => done(`ERROR: ${e.message}`, 1));
ws.on('unexpected-response', (_req, res) => {
  console.log(`UNEXPECTED HTTP ${res.statusCode} ${res.statusMessage}`);
  console.log('  headers:', JSON.stringify(res.headers).slice(0, 300));
  done('handshake rejected', 1);
});
ws.on('close', (c, r) => done(`CLOSED code=${c} reason=${r?.toString() || '(none)'}`, 1));
