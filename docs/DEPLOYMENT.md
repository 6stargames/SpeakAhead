# Deployment

## What has to be true

1. **COOP and COEP headers survive to the browser.** Without them
   `SharedArrayBuffer` is unavailable, inference silently drops to one thread,
   and audio stutters under load. Proxies and CDNs strip headers; check the
   **Diagnostics** panel after every infrastructure change.
2. **`.onnx` and `.data` are served uncompressed and immutable.**
3. **A TURN relay exists** if calls must work on institutional networks.
4. **Signalling is reachable** and, if replicated, shares state.

## Firebase App Hosting (the deployed configuration)

Project `vpx4900`, backend `webmcpaac`, region `us-east4`.

```bash
gcloud auth login                 # an account with access to vpx4900
firebase login --reauth

npm run fetch:models                        # ~409 MB, local
firebase deploy --only hosting:models       # publish the weights
git push                                    # App Hosting builds from GitHub
```

Models live on a dedicated Firebase Hosting site,
`https://webmcp-aac-models.web.app`, kept separate from the project's default
site so a model deploy can never touch anything else. `firebase.json` scopes the
`models` target to that site alone.

### Signalling cannot use WebSockets on this host

Firebase App Hosting's edge refuses WebSocket upgrades. It answers a valid
handshake with `403 Forbidden` and a synthesised `Sec-WebSocket-Accept`, on
**every** path — including ones the origin server would have rejected itself,
which is how you can tell the 403 never reached the container. Plain HTTP to the
same paths passes through untouched.

So the application origin signals over **HTTP long-polling** (`/api/signal/*`),
sharing its room logic with the WebSocket transport via `signaling/rooms.js`.
Long-polling rather than Server-Sent Events because every response completes
normally, so no proxy in the path can buffer a stream and stall call setup. The
extra round trip per message is immaterial: signalling only runs during setup,
and once the peer connection is up, media and real-time text flow directly
between the browsers.

Set `VITE_SIGNALING_URL` to a `ws://` or `wss://` URL to use the WebSocket
transport instead, against a host that permits upgrades — see the standalone
deployment below. Anything else, including the default, uses same-origin HTTP.

`apphosting.yaml` pins `maxInstances: 1` on purpose: `server.js` hosts
signalling in process memory, so with several instances and no shared state two
people entering the same room code can land on different containers and never
see each other. Raise it only after configuring `REDIS_URL` or moving
signalling out.

### Why the models are on Hosting, not Cloud Storage

`public/models/**` is gitignored, so a container built from a clean checkout has
no weights: dictation is unavailable and the platform-voice fallback cannot be
transmitted on a call. They are served from a CDN rather than baked into the
image — ~409 MB would slow every build and every cold start, and the service
worker caches them client-side after first use regardless.

Cloud Storage was the obvious choice and turned out to be unavailable, for two
independent reasons:

1. **A bucket has to be world-readable**, which means granting `allUsers`. This
   organisation enforces Domain Restricted Sharing
   (`constraints/iam.allowedPolicyMemberDomains`, restricted to one customer
   ID), so that binding is rejected with a bare `HTTP 412` that explains
   nothing.
2. **Cloud Storage cannot set `Cross-Origin-Resource-Policy`** on objects. Only
   a fixed set of headers is settable, and CORP is not among them. The
   Emscripten glue loads through `importScripts` — a no-cors request — which
   `COEP: require-corp` blocks outright unless the response carries CORP. A
   bucket origin therefore forces COEP down to `credentialless`, which costs
   Safari its cross-origin isolation and drops it to single-threaded inference.

Firebase Hosting has neither problem: it serves publicly without any IAM
binding, and `firebase.json` sets arbitrary response headers. So the models
carry `Cross-Origin-Resource-Policy: cross-origin`, `Access-Control-Allow-Origin`,
`application/wasm` on `.wasm`, and immutable caching — and the app keeps the
specification's mandated `require-corp`.

`.data` and `.onnx` are served uncompressed. Compressing them buys almost
nothing on dense float matrices and would break the range requests the service
worker uses to resume partial reads offline.

Model paths carry their Sherpa release (`/tts-v1.12.37`, not `/tts`) because
they are served `immutable`. Changing a bundle must change its URL; overwriting
one in place leaves browsers and the CDN serving the old model for a year to
code that expects the new one.

`scripts/setup-gcp.sh` still contains the Cloud Storage path behind
`USE_GCS_MODELS=1`, for organisations where it is actually available.

## Any container host

```bash
npm ci && npm run build
PORT=8080 npm start
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Listen port |
| `COEP_MODE` | `require-corp` | `credentialless` if models come from another origin |
| `ENABLE_SIGNALING` | `true` | `false` when signalling is deployed separately |
| `REDIS_URL` | — | Fan out signalling across replicas |
| `TURN_PROVIDER` | `none` | `shared-secret`, `fetch`, or `none` |
| `TURN_URLS` | — | Comma-separated relay URLs (`shared-secret`) |
| `TURN_SHARED_SECRET` | — | Static auth secret (`shared-secret`) |
| `TURN_CREDENTIALS_URL` | — | Provider credential API (`fetch`) |
| `TURN_CREDENTIALS_METHOD` | `GET`/`POST` | HTTP method for that API |
| `TURN_CREDENTIALS_AUTH_HEADER` | — | `Name: value` auth header for that API |
| `TURN_TTL_SECONDS` | `86400` | Requested credential lifetime |

`/healthz` returns serving mode, COEP mode, TURN provider, and room/peer counts.

### TURN credentials — Cloudflare Realtime

Two secrets, because Cloudflare's credential is really two halves: the TURN
Token ID sits inside the request URL and the API token in the header. Either one
alone is useless; together they are the whole credential, so neither belongs in
git.

```bash
firebase apphosting:secrets:set turnCredentialsUrl --project vpx4900
firebase apphosting:secrets:set turnAuthHeader --project vpx4900
```

Each prompts for its value, creates the Secret Manager secret, and grants the
backend's service account access — without the value reaching your shell
history. The values are:

| Secret | Value |
| --- | --- |
| `turnCredentialsUrl` | `https://rtc.live.cloudflare.com/v1/turn/keys/<TURN_TOKEN_ID>/credentials/generate-ice-servers` |
| `turnAuthHeader` | `Authorization: Bearer <API_TOKEN>` |

`apphosting.yaml` references them by name only. Create the secrets **before**
deploying — a rollout referencing a secret that does not exist fails.

To rotate, delete the TURN app in the Cloudflare dashboard and create a new one:
that changes both halves. Then re-run both commands; App Hosting reads the
latest version, so no code change is needed.

Any other provider works through the same generic path — set
`TURN_CREDENTIALS_URL`, `TURN_CREDENTIALS_METHOD`, `TURN_CREDENTIALS_AUTH_HEADER`
and `TURN_CREDENTIALS_BODY` to whatever their documentation specifies. The three
common response shapes are normalised; see `ice-servers.js`.

### `/api/ice-servers`

TURN credentials are minted per request by the origin and cached until they
approach expiry. They are deliberately **not** exposed through
`VITE_ICE_SERVERS`: that value is inlined at build time, so anything placed
there is readable by anyone who opens the page — and a leaked TURN credential
means relaying strangers' traffic on your bill.

The client fetches this endpoint when a call starts and falls back to the
build-time STUN list if it is unreachable. Responses are `Cache-Control:
private` so a shared cache never holds one user's credentials.

`shared-secret` computes RFC 5766 credentials locally with no network call.
`fetch` asks your provider's own API — you supply the URL, method and auth
header from their documentation, and the three common response shapes are
normalised. If the provider is unreachable the endpoint degrades to STUN and
says so, rather than blocking a call that may not have needed a relay.

## Static CDN

If you serve `dist/` from a CDN rather than `server.js`, you must reproduce the
headers yourself. **Cloudflare Pages** (`_headers`):

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin

/models/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache
```

**Netlify** uses the same `_headers` format. **Vercel** takes the equivalent
under `headers` in `vercel.json`.

Disable automatic compression for `.onnx` and `.data`, and deploy the signalling
server separately — a static CDN cannot host a WebSocket.

## Regional signalling

The specification calls for signalling in a Midwest data centre — us-east-2
(Ohio) or us-central1 (Iowa) — so call setup for users around Chicago stays
inside a short round trip.

```bash
cd signaling
docker build -t aac-signaling .
docker run -p 8081:8081 -e ALLOWED_ORIGINS=https://your.app aac-signaling
```

Then set `VITE_SIGNALING_URL=wss://signal.your.app/signal` and
`ENABLE_SIGNALING=false` on the origin.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8081` | Listen port |
| `SIGNAL_PATH` | `/signal` | Upgrade path |
| `ALLOWED_ORIGINS` | any | Comma-separated origin allowlist |
| `REDIS_URL` | — | Cross-replica fan-out (needs `ioredis`) |

The server keeps SDP and ICE only, in memory, for the lifetime of a room. It
never sees audio or transcripts: real-time text travels peer-to-peer over the
encrypted data channel.

Terminate TLS in front of it and allow WebSocket upgrades. Behind a load
balancer either enable session affinity or configure `REDIS_URL` — without one
of those, two peers may reach different replicas.

## TURN

STUN alone fails behind symmetric NAT, which is the norm on hospital and school
networks — precisely where this device is meant to work. TURN is not optional
for institutional deployments.

`/etc/turnserver.conf`:

```conf
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
relay-ip=YOUR.PUBLIC.IP
external-ip=YOUR.PUBLIC.IP

realm=aac.example.org
server-name=aac.example.org

# Time-limited credentials. Long-lived shared secrets in a client bundle are a
# standing invitation to relay someone else's traffic on your bill.
use-auth-secret
static-auth-secret=REPLACE_WITH_A_LONG_RANDOM_SECRET

cert=/etc/letsencrypt/live/aac.example.org/fullchain.pem
pkey=/etc/letsencrypt/live/aac.example.org/privkey.pem

min-port=49152
max-port=65535

# This relay exists to carry one application's media, not to be an open proxy.
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=169.254.0.0-169.254.255.255

fingerprint
no-cli
```

Open UDP and TCP 3478, TCP 5349, and UDP 49152–65535.

Mint credentials server-side, per session:

```js
const username = `${Math.floor(Date.now() / 1000) + 86400}:${userId}`;
const credential = createHmac('sha1', process.env.TURN_SECRET)
  .update(username)
  .digest('base64');
```

Then:

```bash
VITE_ICE_SERVERS='[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:aac.example.org:3478","turns:aac.example.org:5349"],"username":"...","credential":"..."}]'
```

Verify with **Call → Check connectivity**. A `relay` candidate means the path
works. If TURN is configured but no relay candidate appears, the credentials are
wrong or UDP/3478 is blocked — and the symptom of discovering that mid-call is a
call that connects, shows every sign of working, and carries no audio.

## Rollout checklist

- [ ] `npm run verify` passes
- [ ] Diagnostics reports cross-origin isolation and `SharedArrayBuffer`
- [ ] `.onnx`/`.data` served uncompressed with `immutable`
- [ ] `sw.js` served `no-cache`
- [ ] A relay candidate is obtained from the target network
- [ ] Offline reload works after the models have cached
- [ ] Two-device microphone-isolation test passed (`docs/VERIFICATION.md` §1)
- [ ] `maxInstances` consistent with the signalling topology
