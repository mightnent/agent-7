# Agent 7

Agent 7 is a WhatsApp-to-Manus task execution bridge.

This project is inspired by OpenClaw and NanoClaw. Their local-machine-first setup can be less scalable and harder to standardize for team/enterprise security needs. Agent 7 uses Manus as the execution backend so admins can centrally configure policies, profiles, and access for all members.

## Prerequisites

- Node.js 20+
- npm 10+
- Neon Postgres database

## Setup

```bash
npm install
cp .env.example .env
```

Populate `.env` with real credentials before running the app.

Optional connector auto-selection settings:

- `MANUS_ENABLED_CONNECTOR_UIDS`: CSV allowlist of connector UUIDs to consider for auto-selection.
- `MANUS_MANUAL_CONNECTOR_ALIASES`: JSON alias map (`alias -> connector UUID`) for custom naming or custom MCP connectors.

## First Run (Pair + Configure WhatsApp)

```bash
# 1) Run DB migrations
npm run db:migrate

# 2) Pair your WhatsApp account (scan QR in terminal)
npm run whatsapp:auth

# 3) Configure bot channels/trigger settings
npm run whatsapp:setup

# 4) Start app
npm run dev
```

## Manus Webhook Setup (Required For Final Replies)

Task acknowledgements are sent immediately, but task completion replies are sent via Manus webhooks.
After starting the app, configure a Manus webhook endpoint in API Integration settings:

- Recommended endpoint: `https://<your-public-domain>/api/manus/webhook?secret=<MANUS_WEBHOOK_SECRET>`
- Also supported: `https://<your-public-domain>/api/manus/webhook/<MANUS_WEBHOOK_SECRET>`

Notes:

- Localhost is not reachable from Manus cloud. For local development, expose your app with a tunnel (e.g. ngrok/cloudflared).
- If your secret includes characters like `/` or `=`, use the query-string form above.
- You should see rows in `manus_webhook_events` when callbacks arrive.

You can register the webhook from this project:

```bash
# Option A: set MANUS_WEBHOOK_URL in .env then run
npm run manus:webhook:register

# Option B: pass URL directly
npm run manus:webhook:register -- --url "https://<your-public-domain>/api/manus/webhook?secret=<MANUS_WEBHOOK_SECRET>"
```

Recommended local-dev flow (quick tunnel):

```bash
# Terminal 1: start app
npm run dev

# Terminal 2: start cloudflare tunnel to your local app
cloudflared tunnel --url http://localhost:3000
# Copy the printed https://<random>.trycloudflare.com URL
```

Then set/update `.env`:

```bash
MANUS_WEBHOOK_URL="https://<random>.trycloudflare.com/api/manus/webhook?secret=<MANUS_WEBHOOK_SECRET>"
```

You can also set only the tunnel origin:

```bash
MANUS_WEBHOOK_URL="https://<random>.trycloudflare.com"
```

The register script will auto-expand it to `/api/manus/webhook?secret=...`.

And register:

```bash
npm run manus:webhook:register
```

Important:

- Keep the `cloudflared` process running.
- Re-register only when the tunnel URL changes (common with quick tunnels).
- With a stable domain/named tunnel, registration is usually one-time.

## Scripts

- `npm run dev`: start Next.js in development mode
- `npm run build`: build production assets
- `npm run start`: run production server
- `npm run lint`: run ESLint
- `npm run test`: run unit tests
- `npm run test:watch`: run tests in watch mode
- `npm run test:coverage`: run unit tests with coverage
- `npm run test:integration`: run integration tests (requires `.env`)
- `npm run test:all`: run unit + integration tests (requires `.env`)
- `npm run whatsapp:auth`: pair WhatsApp device and persist Baileys credentials
- `npm run whatsapp:setup`: interactive setup for assistant name + main/registered chats
- `npm run manus:webhook:register`: register callback URL with Manus (`POST /v1/webhooks`)
- `npm run db:generate`: generate Drizzle SQL migrations
- `npm run db:migrate`: run migrations
- `npm run db:studio`: open Drizzle Studio

## Database

Schema is defined in `src/db/schema.ts` and migration output is stored in `drizzle/`.

## Security Notes

- Do not commit `.env`.
- WhatsApp auth/session files are stored under `.data/` and should remain local.
