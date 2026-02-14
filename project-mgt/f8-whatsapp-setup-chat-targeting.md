# F8: Decouple WhatsApp Setup + Chat Targeting

**Date**: 2026-02-13
**Status**: In Progress — auth + setup scripts working, message filtering implemented, not yet tested end-to-end

## Problem

Before F8, the Baileys WhatsApp connection booted automatically via the Next.js instrumentation hook (`src/instrumentation.ts` → `whatsapp-bootstrap.ts`). This caused several issues:

1. **QR code pairing coupled to server lifecycle** — had to run `npm run dev` just to pair
2. **No message filtering** — every incoming message was processed
3. **No self-chat support** — `fromMe` messages were unconditionally skipped
4. **No group whitelisting** — any group message would trigger the bot

The goal is to follow the NanoClaw pattern: separate CLI setup step, explicit group registration, self-chat as admin channel with name-prefix trigger, and phone-number-based JID for tagging.

## What Was Implemented

### New Files

| File | Purpose |
|---|---|
| `src/scripts/whatsapp-auth.ts` | Standalone CLI for QR-code pairing (`npm run whatsapp:auth`) |
| `src/scripts/whatsapp-setup.ts` | Interactive CLI for channel config (`npm run whatsapp:setup`) |
| `src/lib/channel/bot-config.ts` | Config loader + message filter logic |

### Modified Files

| File | Changes |
|---|---|
| `src/lib/channel/whatsapp-bootstrap.ts` | Removed QR rendering, loads BotConfig, filters messages via `shouldProcessMessage`, LID→phone JID translation, passes trigger-stripped text to dispatch |
| `package.json` | Added `whatsapp:auth` and `whatsapp:setup` npm scripts |

### No Changes Needed

| File | Reason |
|---|---|
| `src/instrumentation.ts` | Already dynamically imports `whatsapp-bootstrap.ts` |
| `next.config.ts` | `qrcode-terminal` already in `serverExternalPackages` |

## Architecture

### Setup Flow (one-time)

```
npm run whatsapp:auth
  → Baileys connects, shows QR code
  → User scans with WhatsApp → Linked Devices
  → Credentials saved to WHATSAPP_AUTH_DIR
  → Script exits (after handling 515 restart)

npm run whatsapp:setup
  → Connects using saved credentials
  → Fetches group list via sock.groupFetchAllParticipating()
  → Prompts: assistant name, main channel (self-chat or group), additional groups
  → Writes bot-config.json to WHATSAPP_AUTH_DIR
  → Disconnects cleanly (socket.end, NOT socket.logout)
```

### Runtime Flow (on every `npm run dev`)

```
instrumentation.ts → bootBaileys()
  → loadBotConfig(authDir)
  → If no config → log warning, skip WA connection (server still starts)
  → If config found → connect Baileys (no QR), start message handler
```

### Message Processing Flow

```
Baileys messages.upsert event
  → Extract chatJid, fromMe, raw text
  → Resolve LID → phone JID (for self-chat consistency)
  → shouldProcessMessage(botConfig, { chatJid, text, fromMe }):

      Chat not in registeredChats? → SKIP

      fromMe + isMain (self-chat)?
        → Text starts with assistant name? (e.g. "Mike do X")
          Yes → PROCESS, strip name prefix → "do X"
          No  → SKIP

      fromMe + not isMain?
        → SKIP (own echoes in other chats)

      requiresTrigger (group)?
        → Text starts with @assistantName? (e.g. "@Mike do X")
          Yes → PROCESS, strip @mention prefix → "do X"
          No  → SKIP

      Otherwise → PROCESS as-is

  → normalize → inbound handler → dispatch to Manus (existing pipeline)
```

## Config File Format

Written to `WHATSAPP_AUTH_DIR/bot-config.json` by the setup script:

```json
{
  "assistantName": "Mike",
  "mainChannel": {
    "jid": "6582521181@s.whatsapp.net",
    "name": "Self Chat",
    "requiresTrigger": true
  },
  "registeredChats": {
    "6582521181@s.whatsapp.net": {
      "name": "Self Chat",
      "requiresTrigger": true,
      "isMain": true
    },
    "120363425410637781@g.us": {
      "name": "Aether Lab 2.0",
      "requiresTrigger": true,
      "isMain": false
    }
  }
}
```

## Key Design Decisions

1. **Trigger gating is a simple string prefix check, NOT LLM routing.** It runs before the message enters the processing pipeline. Instant, deterministic, zero cost.

2. **Self-chat uses name prefix** (`Mike do X`) instead of `@mention` (`@Mike do X`) because WhatsApp self-chat doesn't support @-tagging your own JID.

3. **Bot config is file-based** (JSON in auth dir), not env-var-based. This keeps the setup interactive and the config human-readable/editable.

4. **Auth script auto-clears stale credentials.** If `loggedOut` is detected, it removes Baileys credential files (preserving `bot-config.json`) and restarts fresh with a new QR code.

5. **Bootstrap gracefully degrades.** If `bot-config.json` is missing, the server still starts — it just doesn't connect to WhatsApp. This avoids breaking `npm run dev` before setup.

## Bugs Found and Fixed During Implementation

### Bug 1: No reconnect after QR scan (auth script)
- **Symptom**: After scanning QR code, Baileys sends a 515 "restart required" stream error. Original script had no reconnect logic, so it hung.
- **Fix**: Added `connect()` function with `setTimeout(connect, 2_000)` on non-loggedOut close, same pattern as bootstrap.
- **File**: `src/scripts/whatsapp-auth.ts`

### Bug 2: `creds.registered` is false for linked devices (setup script)
- **Symptom**: Setup script checked `authState.creds.registered` which is only set for phone-number registration, not linked-device pairing. Always `false` after QR pairing.
- **Fix**: Changed check to `authState.creds.me` which is populated after successful pairing.
- **File**: `src/scripts/whatsapp-setup.ts`

### Bug 3: `socket.logout()` destroyed credentials (setup script)
- **Symptom**: After setup completed, it called `socket.logout()` which tells WhatsApp to unpair the device. Next server start couldn't connect.
- **Fix**: Changed to `socket.end(undefined)` which closes the WebSocket cleanly without invalidating the session.
- **File**: `src/scripts/whatsapp-setup.ts`

### Bug 4: TypeScript error on `msg.message` type (bootstrap)
- **Symptom**: `extractRawText(msg.message)` failed because Baileys `IMessage` type doesn't satisfy `Record<string, unknown>`.
- **Fix**: Added explicit cast: `msg.message as Record<string, unknown> | null | undefined`.
- **File**: `src/lib/channel/whatsapp-bootstrap.ts`

## LID → Phone JID Translation

Baileys sometimes reports self-chat messages using a "LID" JID (e.g. `94523774529590:97@lid`) instead of the phone-number JID (`6582521181@s.whatsapp.net`). The bootstrap populates a translation map from `authState.creds.me` on connection open:

```
me.id  = "6582521181:97@s.whatsapp.net"  (phone JID with device suffix)
me.lid = "94523774529590:97@lid"           (LID JID)
```

The `resolveJid()` function maps LID → phone JID so `registeredChats` lookup works consistently.

## Testing Status

| Check | Status |
|---|---|
| `npm run build` | Passes |
| `npm run lint` | Clean |
| `npm run test` | 52/53 pass (1 pre-existing failure in `env.test.ts` — expects `open.manus.ai` but schema defaults to `api.manus.ai`, unrelated to F8) |
| QR pairing (`whatsapp:auth`) | Works — handles 515 restart, auto-clears stale creds |
| Interactive setup (`whatsapp:setup`) | Works — writes correct config |
| End-to-end message flow | **NOT YET TESTED** — user still needs to re-pair (credentials were destroyed by the `socket.logout` bug), then run setup, then `npm run dev`, then send self-chat message |

## Known Unknowns / Potential Issues

1. **Self-chat remoteJid format**: Baileys may report self-chat `remoteJid` as `6582521181:97@s.whatsapp.net` (with device suffix) instead of `6582521181@s.whatsapp.net` (what the setup script writes). If the lookup fails, the JID normalization in `resolveJid` may need to strip device suffixes.

2. **LID mapping completeness**: The current LID map only stores `me.lid` → `me.id`. If Baileys uses other LID variants for self-chat, the map may be incomplete.

3. **`extractRawText` duplication**: The bootstrap has its own `extractRawText()` that mirrors `textFromMessage()` in `whatsapp-inbound.ts`. These could drift. Consider extracting to a shared utility if this causes issues.

4. **Group @mention format**: WhatsApp group mentions may arrive as `@6582521181` (phone number) rather than `@Mike` (display name). The current trigger check looks for `@{assistantName}` which is the display name. Need to verify actual Baileys message format for group mentions.

## Files Quick Reference

```
src/scripts/
  whatsapp-auth.ts          # QR pairing CLI
  whatsapp-setup.ts         # Interactive channel config CLI

src/lib/channel/
  bot-config.ts             # Config types + loader + shouldProcessMessage filter
  whatsapp-bootstrap.ts     # Modified: loads config, filters, LID translation

.data/whatsapp-auth/        # Runtime directory (gitignored)
  creds.json                # Baileys credentials
  bot-config.json           # Channel config written by setup script
  pre-key-*.json            # Baileys key material
```

## Next Steps

1. Re-pair WhatsApp (`npm run whatsapp:auth`)
2. Re-run setup (`npm run whatsapp:setup`)
3. Start server (`npm run dev`) and test self-chat message flow
4. Test group @mention flow
5. If remoteJid format issues arise (see Known Unknown #1), add JID normalization
6. Add unit tests for `shouldProcessMessage` in `bot-config.ts`
