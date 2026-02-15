# Agent 7

Agent 7 is a WhatsApp-to-Manus task execution bridge.

This project is inspired by OpenClaw and NanoClaw. Their local-machine-first setup can be less scalable and harder to standardize for team/enterprise security needs. Agent 7 uses Manus as the execution backend so admins can centrally configure policies, profiles, and access for all members.

## Prerequisites

- Node.js 20+
- npm 10+
- Neon Postgres database
- `cloudflared` CLI (for webhook tunneling — install via `brew install cloudflare/cloudflare/cloudflared` on macOS)

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and fill in the three bootstrap values:

```bash
DATABASE_URL="postgresql://..."   # Your Neon connection string
DB_ENCRYPTION_KEY="..."           # Generate with: openssl rand -hex 32
NODE_ENV="development"
```

That's it for `.env` — all other configuration (Manus API key, WhatsApp pairing, tunnel, webhook) is managed through the web-based admin console.

Run the database migrations and start the app:

```bash
npm run db:migrate
npm run dev
```

Then open **http://localhost:3000/guide** in your browser. The setup wizard walks you through each step with auto-detected progress:

1. **Configure Manus API** — enter your API key and webhook secret
2. **Pair WhatsApp** — scan a QR code to link your phone
3. **Start Tunnel** — launch a Cloudflare tunnel and auto-register the Manus webhook

Once all three steps are green, your agent is live.

## CLI Setup (Alternative)

If you prefer command-line setup over the web UI, you can configure everything via `.env` and scripts:

```bash
# 1) Fill all values in .env (see .env.example for the full list)

# 2) Run DB migrations
npm run db:migrate

# 3) Pair your WhatsApp account (scan QR in terminal)
npm run whatsapp:auth

# 4) Configure bot channels/trigger settings
npm run whatsapp:setup

# 5) Start a cloudflare tunnel (separate terminal)
cloudflared tunnel --url http://localhost:3000

# 6) Register the Manus webhook
npm run manus:webhook:register -- --url "https://<tunnel-url>/api/manus/webhook?secret=<MANUS_WEBHOOK_SECRET>"

# 7) Start app
npm run dev
```

## Admin Console

The web-based admin console at **http://localhost:3000** provides:

- **Guide** (`/guide`) — Step-by-step setup wizard with auto-detected progress
- **Channels** (`/channels`) — WhatsApp pairing, group whitelisting, bot config
- **Config** (`/config`) — Settings editor (Manus, Router, Connectors, etc.)
- **Tunnel** (`/tunnel`) — Cloudflare tunnel start/stop with webhook auto-registration
- **Status** (`/status`) — Live health dashboard across all subsystems

All settings are stored encrypted in the workspace database. The app falls back to `.env` values for any setting not yet configured in the DB.

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
- `npm run whatsapp:auth`: pair WhatsApp device via CLI (alternative to web UI)
- `npm run whatsapp:setup`: interactive CLI setup for assistant name + chats
- `npm run manus:webhook:register`: register callback URL with Manus (alternative to web UI)
- `npm run db:generate`: generate Drizzle SQL migrations
- `npm run db:migrate`: run migrations
- `npm run db:studio`: open Drizzle Studio

## Database

Schema is defined in `src/db/schema.ts` and migration output is stored in `drizzle/`.

## Security Notes

- Do not commit `.env`.
- WhatsApp auth state is stored in the database (encrypted). Legacy filesystem auth under `.data/` should remain local if present.
- The admin console is protected by same-origin checks in OSS mode. For remote access, set a `MOCK_TOKEN` in Config.
