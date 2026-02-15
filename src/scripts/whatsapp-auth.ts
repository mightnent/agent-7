#!/usr/bin/env npx tsx
/**
 * Standalone CLI script for WhatsApp QR-code pairing.
 *
 * Usage:
 *   npm run whatsapp:auth
 *
 * Connects to WhatsApp via Baileys, displays a QR code in the terminal,
 * and exits once the device is successfully linked.
 *
 * After scanning the QR code Baileys restarts the connection (stream error 515
 * is expected). The script reconnects automatically and exits once the
 * post-pairing connection opens successfully.
 *
 * Credentials are persisted to WHATSAPP_AUTH_DIR (default: ./.data/whatsapp-auth).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import makeWASocket from "@whiskeysockets/baileys";
import { makeCacheableSignalKeyStore } from "@whiskeysockets/baileys/lib/Utils/auth-utils.js";
import { useMultiFileAuthState } from "@whiskeysockets/baileys/lib/Utils/use-multi-file-auth-state.js";
import type { ConnectionState } from "@whiskeysockets/baileys/lib/Types/State.js";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR ?? "./.data/whatsapp-auth";
const logger = pino({ level: "info" });
const LOGGED_OUT_STATUS_CODE = 401;

/**
 * Remove all Baileys credential files from the auth directory while
 * preserving non-Baileys files like `bot-config.json`.
 */
function clearAuthState(authDir: string): void {
  if (!fs.existsSync(authDir)) return;

  for (const file of fs.readdirSync(authDir)) {
    // Keep bot-config.json across re-pairs
    if (file === "bot-config.json") continue;
    fs.rmSync(path.join(authDir, file), { force: true });
  }
}

async function main(): Promise<void> {
  console.log(`\nWhatsApp Auth — credentials will be saved to: ${AUTH_DIR}\n`);

  // eslint-disable-next-line react-hooks/rules-of-hooks -- Baileys utility, not a React hook
  let { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const connect = (): void => {
    const socket = makeWASocket({
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, logger),
      },
      logger,
    });

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrcodeTerminal.generate(qr, { small: true }, (code: string) => {
          console.log("\n" + code);
        });
        console.log("Scan the QR code above with WhatsApp → Linked Devices → Link a Device\n");
      }

      if (connection === "open") {
        console.log("Successfully paired! Credentials saved.\n");
        process.exit(0);
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;

        if (statusCode === LOGGED_OUT_STATUS_CODE) {
          console.log("Stale credentials detected — clearing auth state and retrying...\n");
          clearAuthState(AUTH_DIR);

          // Reload auth state from the now-empty directory so Baileys
          // generates fresh identity keys and shows a new QR code.
          const reloaded = await useMultiFileAuthState(AUTH_DIR);
          authState = reloaded.state;
          saveCreds = reloaded.saveCreds;

          setTimeout(connect, 1_000);
          return;
        }

        // After initial pairing Baileys sends a 515 "restart required" —
        // reconnect with a fresh socket so the post-pairing handshake completes.
        console.log(`Connection closed (status ${statusCode}), reconnecting...`);
        setTimeout(connect, 2_000);
      }
    });
  };

  connect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
