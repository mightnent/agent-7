# F12: Admin Console — Self-Service Setup, Channel Management & DB-Backed Config

**Date**: 2026-02-15
**Status**: Planning
**Depends on**: F11 Phase 1 (workspace scoping — complete)

## Problem Statement

The current setup experience requires:

1. **Manual `.env` editing** for ~20 config values — error-prone, not scalable, incompatible with multi-tenant.
2. **Terminal-only WhatsApp pairing** (`npm run whatsapp:auth`) — requires SSH/terminal access, not viable for non-technical users or managed deployments.
3. **Manual Cloudflare tunnel** — user must run `cloudflared` in a separate terminal, copy the URL, paste into `.env`, then run the webhook registration script.
4. **No runtime visibility** — no way to see connection status, recent tasks, or config state without reading logs or querying the DB directly.

These are acceptable for a solo developer during initial build, but block:
- Non-technical users from self-hosting
- Multi-workspace managed deployments (each workspace needs its own config)
- Any kind of onboarding experience

## Goal

Build a web-based admin console that replaces all CLI-based setup workflows with a guided UI. All runtime configuration moves from `.env` to encrypted DB storage, scoped per workspace. The `.env` file shrinks to only bootstrap secrets (DB connection + encryption key).

## Design Principles

1. **DB-first config**: All application config lives in the database, encrypted at rest. `.env` is only for bootstrap.
2. **Workspace-scoped**: Every setting is tied to a `workspace_id`, aligning with F11's multi-tenant architecture.
3. **Graceful migration**: During transition, the system reads DB first, falls back to env. No big-bang migration required.
4. **Progressive disclosure**: The UI guides new users through setup in order (Manus API key → WhatsApp pairing → tunnel → webhook registration), but experienced users can jump to any section.

## Architecture

### What stays in `.env` (bootstrap-only)

| Variable | Reason |
|---|---|
| `DATABASE_URL` | Chicken-and-egg: needed to connect to DB where other config lives |
| `DB_ENCRYPTION_KEY` | Master key for AES-256-GCM encryption of sensitive DB values. 32-byte hex string. |
| `NODE_ENV` | Runtime mode, not application config |

Everything else moves to `workspace_settings`.

### New DB Table: `workspace_settings`

```
workspace_settings
├── id (uuid pk)
├── workspace_id (fk → workspaces.id)
├── category (text) — logical grouping: 'manus', 'router', 'connectors', 'whatsapp', 'internal', 'tunnel'
├── key (text) — setting name within category
├── value (text) — plaintext value (non-sensitive)
├── encrypted_value (bytea, nullable) — AES-256-GCM ciphertext (sensitive values)
├── is_sensitive (boolean, default false) — if true, value lives in encrypted_value
├── updated_at (timestamptz)
├── created_at (timestamptz)
└── unique (workspace_id, category, key)
```

Indexes:
- unique (`workspace_id`, `category`, `key`)
- index (`workspace_id`, `category`) — for loading a full category

### New DB Table: `workspace_channels`

Replaces `bot-config.json` with DB-backed channel registration.

```
workspace_channels
├── id (uuid pk)
├── workspace_id (fk → workspaces.id)
├── channel (enum: 'whatsapp')
├── status (enum: 'disconnected', 'pairing', 'connected', 'error')
├── config_json (jsonb) — channel-specific config (assistant name, registered chats, etc.)
├── last_connected_at (timestamptz, nullable)
├── error_message (text, nullable)
├── updated_at (timestamptz)
├── created_at (timestamptz)
└── unique (workspace_id, channel)
```

### Encryption Model

```
┌──────────────────────────────────┐
│  .env                            │
│  DB_ENCRYPTION_KEY=<64-char hex> │  ← 32-byte key, hex-encoded
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  src/lib/crypto/settings-cipher.ts           │
│                                              │
│  encrypt(plaintext, key) → {iv, ciphertext, tag}  │
│  decrypt(encrypted, key) → plaintext         │
│                                              │
│  Format: AES-256-GCM                         │
│  IV: 12 bytes, random per encryption         │
│  Auth tag: 16 bytes                          │
│  Storage: iv || tag || ciphertext (bytea)    │
└──────────────────────────────────────────────┘
```

Key rotation: Add a `key_version` column to `workspace_settings` to support future key rotation without re-encrypting everything at once.

### Config Resolution Order

```
1. Read from workspace_settings WHERE workspace_id = ? AND category = ? AND key = ?
2. If not found → fall back to process.env[mapped_env_name]
3. If not found → use hardcoded default (same defaults as current env.ts)
```

This allows:
- Existing `.env`-based deployments to keep working without DB migration
- New deployments to configure everything through the UI
- Per-workspace overrides in multi-tenant mode

### Setting Categories & Keys

| Category | Key | Sensitive | Current Env Var | Notes |
|---|---|---|---|---|
| `manus` | `api_key` | yes | `MANUS_API_KEY` | |
| `manus` | `base_url` | no | `MANUS_BASE_URL` | Default: `https://api.manus.ai` |
| `manus` | `webhook_secret` | yes | `MANUS_WEBHOOK_SECRET` | Auto-generated on first setup |
| `manus` | `webhook_url` | no | `MANUS_WEBHOOK_URL` | Set automatically by tunnel manager |
| `manus` | `agent_profile` | no | `MANUS_AGENT_PROFILE` | Dropdown: manus-1.6 / lite / max |
| `router` | `llm_provider` | no | `ROUTER_LLM_PROVIDER` | Dropdown: none / openai_compatible |
| `router` | `llm_api_key` | yes | `ROUTER_LLM_API_KEY` | |
| `router` | `llm_model` | no | `ROUTER_LLM_MODEL` | |
| `router` | `llm_base_url` | no | `ROUTER_LLM_BASE_URL` | |
| `connectors` | `catalog_url` | no | `MANUS_CONNECTOR_CATALOG_URL` | |
| `connectors` | `catalog_limit` | no | `MANUS_CONNECTOR_CATALOG_LIMIT` | |
| `connectors` | `catalog_ttl_ms` | no | `MANUS_CONNECTOR_CATALOG_TTL_MS` | |
| `connectors` | `enabled_uids` | no | `MANUS_ENABLED_CONNECTOR_UIDS` | CSV |
| `connectors` | `manual_aliases` | no | `MANUS_MANUAL_CONNECTOR_ALIASES` | JSON |
| `internal` | `cleanup_token` | yes | `INTERNAL_CLEANUP_TOKEN` | Auto-generated on first setup |
| `whatsapp` | `auth_dir` | no | `WHATSAPP_AUTH_DIR` | Default: `./.data/whatsapp-auth` |
| `whatsapp` | `session_name` | no | `WHATSAPP_SESSION_NAME` | Default: `default` |

### UI Structure

```
┌─────────────────────────────────────────────────────────┐
│  Agent Console                                     [ws] │
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│  Setup   │   (content area — varies by tab)             │
│  ────    │                                              │
│ ● Guide  │                                              │
│          │                                              │
│  Manage  │                                              │
│  ──────  │                                              │
│ ○ Chann. │                                              │
│ ○ Config │                                              │
│ ○ Tunnel │                                              │
│          │                                              │
│  Monitor │                                              │
│  ─────── │                                              │
│ ○ Status │                                              │
│          │                                              │
└──────────┴──────────────────────────────────────────────┘
```

**Sidebar sections:**

1. **Setup > Guide** — First-run wizard. Steps through: Manus API key → WhatsApp pairing → Tunnel → Webhook registration. Shows completion status per step.

2. **Manage > Channels** — WhatsApp pairing (QR code in browser), connection status, bot config (assistant name, registered chats). Replaces `whatsapp:auth` and `whatsapp:setup` scripts.

3. **Manage > Config** — Grouped settings editor. Card per category (Manus, Router, Connectors, Internal). Sensitive fields masked with reveal toggle. Save writes to `workspace_settings`.

4. **Manage > Tunnel** — Start/stop Cloudflare tunnel. Shows current URL. Auto-registers Manus webhook on tunnel start. Shows tunnel process status.

5. **Monitor > Status** — Connection health dashboard. WhatsApp connection state, tunnel status, last webhook received, recent task activity. (Phase 2 — can be a simple status card initially.)

### WhatsApp Auth in Browser

Replace the terminal QR flow with a browser-based one:

```
┌─ Browser ──────────────────┐     ┌─ Server ──────────────────────┐
│                             │     │                                │
│  1. User clicks "Pair"      │────►│  2. POST /api/channels/        │
│                             │     │     whatsapp/pair               │
│                             │     │  3. Start Baileys connection    │
│  4. SSE stream opens ◄──────│◄────│     (no printQRInTerminal)     │
│     /api/channels/          │     │  4. On QR event → push via SSE │
│     whatsapp/pair/stream    │     │                                │
│                             │     │                                │
│  5. Render QR code          │     │  6. On connection.update:      │
│     (qrcode lib in browser) │     │     open → push "connected"    │
│                             │     │     via SSE                     │
│  7. Show "Connected!" +     │◄────│                                │
│     proceed to bot setup    │     │  8. Persist auth state         │
│                             │     │     Update workspace_channels  │
└─────────────────────────────┘     └────────────────────────────────┘
```

Key implementation details:
- Server-Sent Events (SSE) for real-time QR updates (simpler than WebSocket for unidirectional stream)
- QR code rendered client-side using `qrcode` npm package (canvas/SVG)
- Baileys `qr` event fires every ~20 seconds with a new QR string — each is pushed over SSE
- On successful pairing, SSE sends `{type: "connected", phoneNumber: "..."}` and closes
- On failure/timeout, SSE sends `{type: "error", message: "..."}` and closes
- Auth state still stored on filesystem (Phase 1) — DB-backed auth state is Phase 2 scope

### Bot Config UI (replaces `whatsapp:setup` script)

After WhatsApp pairing, the Channels page shows:

1. **Assistant Name** — text input for the trigger name (e.g., "Manus")
2. **Main Channel** — radio: "Self-chat" or "Group"
   - Self-chat: phone number input
   - Group: dropdown populated from `sock.groupFetchAllParticipating()`
3. **Additional Groups** — multi-select checklist of available groups
4. **Save** — writes to `workspace_channels.config_json` (same schema as `bot-config.json`)

The API route fetches groups via the active Baileys connection (available via `globalThis` runtime adapter).

### Cloudflare Tunnel Management

```
┌─ Browser ──────────────────┐     ┌─ Server ──────────────────────────┐
│                             │     │                                    │
│  1. User clicks "Start"     │────►│  2. POST /api/tunnel/start         │
│                             │     │  3. spawn('cloudflared',            │
│                             │     │     ['tunnel','--url',              │
│  4. Poll GET /api/tunnel/   │◄────│      'http://localhost:3000'])      │
│     status                  │     │  4. Parse stdout for URL            │
│                             │     │     regex: https://.*trycloudflare  │
│  5. Show tunnel URL         │     │  5. Store URL in workspace_settings │
│     + "Webhook registered"  │     │  6. Auto-register Manus webhook    │
│                             │     │     (reuse manus-webhook-register   │
│  6. User clicks "Stop"      │────►│      logic)                        │
│                             │     │  7. POST /api/tunnel/stop           │
│                             │     │  8. Kill child process              │
└─────────────────────────────┘     └────────────────────────────────────┘
```

Implementation details:
- Store `cloudflared` child process reference on `globalThis` (same pattern as Baileys adapter)
- Parse stdout line-by-line for the tunnel URL
- On tunnel URL captured: auto-update `workspace_settings` (manus.webhook_url) and call Manus webhook registration API
- On tunnel stop: kill process, clear URL from settings
- Require `cloudflared` binary to be installed (show install instructions if not found)
- Health check: periodic process.alive check, restart if crashed

### Config Service Layer

```typescript
// src/lib/config/settings-service.ts

interface SettingsService {
  get(workspaceId: string, category: string, key: string): Promise<string | null>;
  getCategory(workspaceId: string, category: string): Promise<Record<string, string>>;
  set(workspaceId: string, category: string, key: string, value: string): Promise<void>;
  delete(workspaceId: string, category: string, key: string): Promise<void>;
}

// Handles encryption/decryption transparently based on setting sensitivity metadata
// Falls back to process.env when DB value not found
```

The existing `src/lib/env.ts` Zod parser will be refactored to:
1. First call `settingsService.getCategory(workspaceId, category)` for each category
2. Fall back to `process.env` for any missing keys
3. Apply same Zod validation on the merged result
4. Cache resolved config per workspace with short TTL (30s) for performance

### UI Tech Stack

- **shadcn/ui** — component library (Button, Card, Input, Select, Tabs, Sidebar, Dialog, Toast)
- **Tailwind CSS v4** — already compatible with Next.js 16
- **React Server Components** where possible, Client Components for interactive forms
- **Server Actions** for form submissions (config save, tunnel start/stop)
- No additional state management library — React state + server actions sufficient for this scope

### API Routes (New)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/settings/:category` | Read settings for a category (workspace-scoped) |
| PUT | `/api/settings/:category` | Upsert settings for a category |
| POST | `/api/channels/whatsapp/pair` | Initiate WhatsApp pairing |
| GET | `/api/channels/whatsapp/pair/stream` | SSE stream for QR code updates |
| POST | `/api/channels/whatsapp/disconnect` | Disconnect WhatsApp |
| GET | `/api/channels/whatsapp/status` | Connection status + phone info |
| GET | `/api/channels/whatsapp/groups` | List available WhatsApp groups |
| PUT | `/api/channels/whatsapp/config` | Save bot config (assistant name, chats) |
| POST | `/api/tunnel/start` | Start Cloudflare tunnel |
| POST | `/api/tunnel/stop` | Stop Cloudflare tunnel |
| GET | `/api/tunnel/status` | Tunnel status + URL |
| GET | `/api/status/health` | Aggregate health (WhatsApp, tunnel, Manus webhook) |

All routes are workspace-scoped. In OSS mode, they use the default workspace. In managed mode (F11 Phase 3+), they'll require authentication and resolve workspace from session.

### App Router Page Structure

```
src/app/
├── (dashboard)/
│   ├── layout.tsx          ← Sidebar + main content shell
│   ├── page.tsx            ← Redirects to /guide or /channels
│   ├── guide/
│   │   └── page.tsx        ← Setup wizard
│   ├── channels/
│   │   └── page.tsx        ← WhatsApp pairing + bot config
│   ├── config/
│   │   └── page.tsx        ← Settings editor (grouped cards)
│   ├── tunnel/
│   │   └── page.tsx        ← Tunnel management
│   └── status/
│       └── page.tsx        ← Health dashboard
└── api/
    ├── settings/
    │   └── [category]/
    │       └── route.ts
    ├── channels/
    │   └── whatsapp/
    │       ├── pair/
    │       │   ├── route.ts
    │       │   └── stream/
    │       │       └── route.ts
    │       ├── disconnect/
    │       │   └── route.ts
    │       ├── status/
    │       │   └── route.ts
    │       ├── groups/
    │       │   └── route.ts
    │       └── config/
    │           └── route.ts
    ├── tunnel/
    │   ├── start/
    │   │   └── route.ts
    │   ├── stop/
    │   │   └── route.ts
    │   └── status/
    │       └── route.ts
    └── status/
        └── health/
            └── route.ts
```

## Implementation Phases

### Phase 1: Foundation — DB Settings + Encryption + Config UI

**Scope:**
- Add `workspace_settings` table + migration
- Implement `SettingsCipher` (AES-256-GCM encrypt/decrypt)
- Implement `SettingsService` (CRUD with encryption + env fallback)
- Install shadcn/ui + Tailwind CSS
- Build dashboard layout shell (sidebar + content area)
- Build Config page (settings editor with category cards)
- Refactor `env.ts` to use `SettingsService` with env fallback
- Add `DB_ENCRYPTION_KEY` to `.env.example`, remove all other non-bootstrap vars from required env

**Deliverables:**
- `src/db/schema.ts` updated with `workspace_settings`
- `src/lib/crypto/settings-cipher.ts`
- `src/lib/config/settings-service.ts`
- `src/app/(dashboard)/layout.tsx` (sidebar shell)
- `src/app/(dashboard)/config/page.tsx` (settings editor)
- `src/app/api/settings/[category]/route.ts`
- Migration generated and applied

**Success criteria:**
- User can set Manus API key through the UI
- Value stored encrypted in DB
- Application reads from DB, falls back to env
- Existing `.env`-only deployments continue to work unchanged

### Phase 2: WhatsApp Channel Management

**Scope:**
- Add `workspace_channels` table + migration
- Build WhatsApp pairing flow (SSE + QR code in browser)
- Build bot config UI (assistant name, channel selection, group registration)
- API routes for pair, disconnect, status, groups, config
- Modify Baileys bootstrap to read bot-config from DB (`workspace_channels.config_json`) with filesystem fallback

**Deliverables:**
- `src/db/schema.ts` updated with `workspace_channels`
- `src/app/(dashboard)/channels/page.tsx`
- `src/app/api/channels/whatsapp/*/route.ts` (5 routes)
- SSE stream handler for QR code delivery
- Client-side QR renderer component

**Success criteria:**
- User can pair WhatsApp entirely through the browser (no terminal needed)
- User can configure assistant name and register chats through the UI
- Bot config saved to DB, Baileys bootstrap reads from DB
- Connection status visible in UI

### Phase 3: Cloudflare Tunnel Management

**Scope:**
- Build tunnel start/stop/status API routes
- Build tunnel management UI page
- Auto-register Manus webhook on tunnel URL capture
- Process lifecycle management (spawn, monitor, kill)
- Tunnel status polling from UI

**Deliverables:**
- `src/lib/tunnel/manager.ts` (spawn/kill/status)
- `src/app/(dashboard)/tunnel/page.tsx`
- `src/app/api/tunnel/*/route.ts` (3 routes)

**Success criteria:**
- User clicks "Start Tunnel" → tunnel starts → URL displayed → webhook auto-registered
- User clicks "Stop Tunnel" → process killed → status updated
- Tunnel crash detected and shown in UI

### Phase 4: Setup Guide + Status Dashboard

**Scope:**
- Build guided setup wizard (step-by-step: API key → WhatsApp → Tunnel → Webhook)
- Build health status page (WhatsApp connection, tunnel, last webhook, recent tasks)
- Auto-detect completion state per setup step

**Deliverables:**
- `src/app/(dashboard)/guide/page.tsx`
- `src/app/(dashboard)/status/page.tsx`
- `src/app/api/status/health/route.ts`

**Success criteria:**
- New user can go from zero to fully running by following the guide
- Status page shows live system health at a glance

## Work Items

| Key | Title | Phase | Status |
|---|---|---|---|
| F12-1 | Add `workspace_settings` table + migration | 1 | Complete |
| F12-2 | Implement AES-256-GCM settings cipher | 1 | Complete |
| F12-3 | Implement SettingsService (CRUD + encryption + env fallback) | 1 | Complete |
| F12-4 | Install shadcn/ui + Tailwind CSS, scaffold dashboard layout | 1 | Complete |
| F12-5 | Build Config page (settings editor with category cards) | 1 | Complete |
| F12-6 | Build settings API routes (GET/PUT by category) | 1 | Complete |
| F12-7 | Refactor env.ts to use SettingsService with fallback | 1 | Complete |
| F12-8 | Add `workspace_channels` table + migration | 2 | Pending |
| F12-9 | Build WhatsApp pairing SSE endpoint + QR stream | 2 | Pending |
| F12-10 | Build Channels page (pairing UI + bot config editor) | 2 | Pending |
| F12-11 | Build WhatsApp API routes (pair, disconnect, status, groups, config) | 2 | Pending |
| F12-12 | Modify Baileys bootstrap to read bot-config from DB | 2 | Pending |
| F12-12b | Add `whatsapp_auth_keys` table + `useDbAuthState` adapter | 2 | Pending |
| F12-12c | Filesystem-to-DB auth state migration script | 2 | Pending |
| F12-13 | Implement tunnel process manager (spawn/kill/monitor) | 3 | Pending |
| F12-14 | Build Tunnel page + API routes (start/stop/status) | 3 | Pending |
| F12-15 | Auto-register Manus webhook on tunnel URL capture | 3 | Pending |
| F12-16 | Build setup guide wizard page | 4 | Pending |
| F12-17 | Build status/health dashboard page + API | 4 | Pending |

## Security Considerations

1. **Encryption key management**: `DB_ENCRYPTION_KEY` must be 32 bytes (accepted formats: 64-char hex or base64 that decodes to 32 bytes). Document generation: `openssl rand -hex 32`.
2. **No plaintext secrets in DB**: All `is_sensitive=true` values stored only in `encrypted_value`. The `value` column is NULL for sensitive settings.
3. **API route protection**: In OSS mode, admin routes are unprotected (single-user assumption). In managed mode (F11 Phase 3+), routes require authenticated session + `settings.manage` permission.
4. **Tunnel security**: The tunnel exposes the local server publicly. Document risks. Consider adding a toggle for "development only" warning.
5. **SSE auth**: WhatsApp pairing SSE stream should validate the request comes from an authenticated session (managed mode) or same-origin (OSS mode).
6. **Key rotation**: `key_version` column allows future rotation. Decrypt with old key, re-encrypt with new key, bump version.

## Migration Path (Existing Deployments)

For users upgrading from `.env`-only setup:

1. Add `DB_ENCRYPTION_KEY` to `.env` (generate with `openssl rand -hex 32`)
2. Run `npm run db:migrate` (Phase 1 adds `workspace_settings`; `workspace_channels` is Phase 2)
3. Application starts normally — all config still reads from `.env` via fallback
4. User can optionally move config to DB through the UI at their own pace
5. Once config is in DB, the `.env` vars can be removed (except `DATABASE_URL` + `DB_ENCRYPTION_KEY`)

No forced migration. No breaking changes. Fully backwards compatible.

## Resolved Decisions

1. **Baileys auth state storage**: Keep filesystem in Phase 1. Move to DB in Phase 2 (see design below). Not hard — just a key-value adapter swap.
2. **Config caching TTL**: 30 seconds, no write-through invalidation. Keep it simple for now.
3. **Tunnel alternatives**: Cloudflared only. No abstraction layer for other providers.

### Baileys Auth State — DB Migration Design (Phase 2)

Baileys' `useMultiFileAuthState` stores 914 files (~3.7MB) on disk:

| File pattern | Count | Purpose |
|---|---|---|
| `creds.json` | 1 | Core identity (Signal keys, account info, phone number) |
| `pre-key-*.json` | ~800 | Signal protocol one-time pre-keys |
| `session-*.json` | ~5 | Signal sessions with individual contacts |
| `sender-key-*.json` | ~5 | Group message encryption keys |
| `app-state-sync-key-*.json` | ~50 | WhatsApp app state sync keys |
| `app-state-sync-version-*.json` | 3 | Sync version tracking |
| `bot-config.json` | 1 | Our bot config (moves to `workspace_channels` separately) |
| `device-list.json`, `lid-mapping.json`, `tctoken.json` | 3 | Metadata |

Despite the file count, the underlying model is a simple key-value store: `{type}-{id}` → JSON blob. Baileys exposes a clean interface (`AuthenticationState.keys.get(type, ids)` / `.set(data)`) that abstracts the storage backend.

**New DB table: `whatsapp_auth_keys`**

```
whatsapp_auth_keys
├── workspace_id (fk → workspaces.id)
├── session_name (text, default 'default')
├── key_type (text) — 'creds', 'pre-key', 'session', 'sender-key', 'app-state-sync-key', etc.
├── key_id (text) — the ID portion (e.g., '721', '260395512115289_1.0')
├── value (jsonb) — the JSON content of the key
├── updated_at (timestamptz)
└── unique (workspace_id, session_name, key_type, key_id)
```

**Custom auth state adapter (~50 lines):**

```typescript
// src/lib/channel/db-auth-state.ts
// Implements the same interface as useMultiFileAuthState but backed by DB

async function useDbAuthState(db, workspaceId, sessionName) {
  const writeData = (type, id, value) =>
    db.upsert(whatsappAuthKeys, { workspaceId, sessionName, keyType: type, keyId: id, value });

  const readData = (type, id) =>
    db.select(whatsappAuthKeys, { workspaceId, sessionName, keyType: type, keyId: id });

  const removeData = (type, id) =>
    db.delete(whatsappAuthKeys, { workspaceId, sessionName, keyType: type, keyId: id });

  // creds.json maps to keyType='creds', keyId='main'
  // pre-key-721.json maps to keyType='pre-key', keyId='721'
  // Same get/set/saveCreds interface as useMultiFileAuthState
  return { state, saveCreds };
}
```

**Why this works for multi-tenant:**
- Each workspace + session_name combo is an isolated auth state
- No filesystem dependency — works on stateless/serverless infra
- Credentials encrypted via the same `DB_ENCRYPTION_KEY` cipher (creds.json contains private keys)
- Existing filesystem auth state can be migrated with a one-time import script

**Phase 2 swap plan:**
1. Add `whatsapp_auth_keys` table + migration
2. Implement `useDbAuthState` adapter
3. Add one-time migration script: read `.data/whatsapp-auth/*` → insert into DB
4. Update Baileys bootstrap to use `useDbAuthState` with filesystem fallback
5. Once DB auth state is verified working, filesystem becomes optional

## Recommended Immediate Next Step

Start with Phase 1 (F12-1 through F12-7). This unlocks the DB-backed config pattern that Phases 2-4 depend on, and gives users an immediate visual experience (the dashboard shell + config editor) even before channel management is built.
