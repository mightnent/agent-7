#!/usr/bin/env npx tsx
/**
 * Interactive CLI for configuring bot channels after WhatsApp pairing.
 *
 * Usage:
 *   npm run whatsapp:setup
 *
 * Steps:
 *   1. Connects to WhatsApp and fetches all groups
 *   2. Prompts for assistant name (alias / trigger word)
 *   3. Prompts for main channel: self-chat or a group
 *   4. Prompts for additional groups to register
 *   5. Writes bot-config.json into WHATSAPP_AUTH_DIR
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

import {
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR ?? "./.data/whatsapp-auth";
const CONFIG_FILE = path.join(AUTH_DIR, "bot-config.json");
const logger = pino({ level: "warn" });

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (question: string): Promise<string> =>
  new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

const askWithDefault = async (question: string, defaultValue: string): Promise<string> => {
  const answer = await ask(`${question} [${defaultValue}]: `);
  return answer || defaultValue;
};

const askChoice = async (question: string, options: string[]): Promise<number> => {
  console.log(`\n${question}`);
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
  while (true) {
    const answer = await ask(`Enter number (1-${options.length}): `);
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= options.length) {
      return num - 1;
    }
    console.log("Invalid selection, try again.");
  }
};

const askMultiSelect = async (question: string, options: string[]): Promise<number[]> => {
  if (options.length === 0) return [];
  console.log(`\n${question}`);
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
  console.log("  0. (none / done)");
  const answer = await ask("Enter numbers separated by commas (e.g. 1,3,5) or 0 for none: ");
  if (answer === "0" || !answer) return [];
  const indices = answer
    .split(",")
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((n) => n >= 0 && n < options.length);
  return [...new Set(indices)];
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface RegisteredChat {
  name: string;
  requiresTrigger: boolean;
  isMain: boolean;
}

interface BotConfig {
  assistantName: string;
  mainChannel: { jid: string; name: string; requiresTrigger: boolean };
  registeredChats: Record<string, RegisteredChat>;
}

async function main(): Promise<void> {
  console.log("\n=== WhatsApp Bot Setup ===\n");

  // --- Connect ---
  console.log(`Connecting to WhatsApp (auth dir: ${AUTH_DIR})...`);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Baileys utility, not a React hook
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  if (!authState.creds.me) {
    console.error("No paired credentials found. Run `npm run whatsapp:auth` first.");
    process.exit(1);
  }

  const socket = makeWASocket({
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, logger),
    },
    logger,
  });

  socket.ev.on("creds.update", saveCreds);

  // Wait for connection to open
  await new Promise<void>((resolve, reject) => {
    socket.ev.on("connection.update", (update) => {
      if (update.connection === "open") {
        resolve();
      }
      if (update.connection === "close") {
        const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } })
          ?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          reject(new Error("Logged out. Run `npm run whatsapp:auth` to re-pair."));
        }
        // Otherwise Baileys will retry automatically
      }
    });
  });

  console.log("Connected!\n");

  // --- Fetch groups ---
  console.log("Fetching group list...");
  const groups = await socket.groupFetchAllParticipating();
  const groupEntries = Object.entries(groups).map(([jid, meta]) => ({
    jid,
    name: meta.subject || jid,
  }));
  console.log(`Found ${groupEntries.length} group(s).\n`);

  // --- Assistant name ---
  const assistantName = await askWithDefault("Assistant name (trigger alias)", "Manus");

  // --- Main channel ---
  const channelTypeIdx = await askChoice("Main channel type:", ["Self-chat (your own number)", "Group"]);

  let mainJid: string;
  let mainName: string;

  if (channelTypeIdx === 0) {
    // Self-chat
    const phoneNumber = await ask("Your phone number (digits only, with country code, e.g. 6581234567): ");
    if (!phoneNumber || !/^\d+$/.test(phoneNumber)) {
      console.error("Invalid phone number. Must be digits only.");
      process.exit(1);
    }
    mainJid = `${phoneNumber}@s.whatsapp.net`;
    mainName = "Self Chat";
  } else {
    // Group
    if (groupEntries.length === 0) {
      console.error("No groups found. Create a group first or use self-chat.");
      process.exit(1);
    }
    const groupIdx = await askChoice(
      "Select main group:",
      groupEntries.map((g) => g.name),
    );
    mainJid = groupEntries[groupIdx].jid;
    mainName = groupEntries[groupIdx].name;
  }

  // --- Additional groups ---
  const remainingGroups = groupEntries.filter((g) => g.jid !== mainJid);
  const additionalIndices = await askMultiSelect(
    "Register additional groups (messages require @trigger):",
    remainingGroups.map((g) => g.name),
  );

  // --- Build config ---
  const registeredChats: Record<string, RegisteredChat> = {};

  registeredChats[mainJid] = {
    name: mainName,
    requiresTrigger: true,
    isMain: true,
  };

  for (const idx of additionalIndices) {
    const group = remainingGroups[idx];
    registeredChats[group.jid] = {
      name: group.name,
      requiresTrigger: true,
      isMain: false,
    };
  }

  const config: BotConfig = {
    assistantName,
    mainChannel: {
      jid: mainJid,
      name: mainName,
      requiresTrigger: true,
    },
    registeredChats,
  };

  // --- Write config ---
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
  console.log(`\nConfig saved to: ${CONFIG_FILE}`);
  console.log(JSON.stringify(config, null, 2));

  // --- Cleanup ---
  rl.close();
  socket.end(undefined);
  // Force exit since Baileys keeps background timers
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
