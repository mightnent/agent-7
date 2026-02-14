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
- `npm run db:generate`: generate Drizzle SQL migrations
- `npm run db:migrate`: run migrations
- `npm run db:studio`: open Drizzle Studio

## Database

Schema is defined in `src/db/schema.ts` and migration output is stored in `drizzle/`.

## Security Notes

- Do not commit `.env`.
- WhatsApp auth/session files are stored under `.data/` and should remain local.
