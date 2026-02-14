/**
 * Bot configuration loader and message filtering logic.
 *
 * Loads `bot-config.json` from the WhatsApp auth directory and provides
 * helpers to determine whether an incoming message should be processed.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisteredChat {
  name: string;
  requiresTrigger: boolean;
  isMain: boolean;
}

export interface BotConfig {
  assistantName: string;
  mainChannel: { jid: string; name: string; requiresTrigger: boolean };
  registeredChats: Record<string, RegisteredChat>;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadBotConfig(authDir: string): BotConfig | null {
  const configPath = path.join(authDir, "bot-config.json");

  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);

  // Basic shape validation
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("assistantName" in parsed) ||
    !("mainChannel" in parsed) ||
    !("registeredChats" in parsed)
  ) {
    return null;
  }

  return parsed as BotConfig;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function isRegisteredChat(config: BotConfig, jid: string): boolean {
  return jid in config.registeredChats;
}

/**
 * If the message text starts with `@{assistantName}` (group mention trigger),
 * return the text with the prefix stripped. Otherwise return `null`.
 */
export function stripMentionTrigger(config: BotConfig, text: string): string | null {
  const prefix = `@${config.assistantName.toLowerCase()}`;
  if (text.toLowerCase().startsWith(prefix)) {
    return text.slice(prefix.length).trimStart();
  }
  return null;
}

/**
 * If the message text starts with `{assistantName}` (self-chat name trigger),
 * return the text with the prefix stripped. Otherwise return `null`.
 */
export function stripNameTrigger(config: BotConfig, text: string): string | null {
  const name = config.assistantName.toLowerCase();
  if (text.toLowerCase().startsWith(name)) {
    return text.slice(name.length).trimStart();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Message filter
// ---------------------------------------------------------------------------

export interface MessageFilterInput {
  chatJid: string;
  text: string | null;
  fromMe: boolean;
}

/**
 * Canonicalize WhatsApp JIDs so config matching works across Baileys variants.
 *
 * Examples:
 *   - 6582521181:97@s.whatsapp.net -> 6582521181@s.whatsapp.net
 *   - 94523774529590:97@lid        -> 94523774529590@lid
 */
export function canonicalizeJid(jid: string): string {
  const trimmed = jid.trim();
  if (!trimmed) {
    return trimmed;
  }

  const deviceQualifiedMatch = trimmed.match(/^([^:@]+):\d+@(s\.whatsapp\.net|lid)$/);
  if (!deviceQualifiedMatch) {
    return trimmed;
  }

  return `${deviceQualifiedMatch[1]}@${deviceQualifiedMatch[2]}`;
}

/**
 * Determines whether an incoming message should be processed, and if so,
 * returns the (possibly trigger-stripped) text. Returns `{ process: false }` to skip.
 *
 * Flow:
 *   1. Chat not registered → skip
 *   2. fromMe + isMain (self-chat) → require name prefix (e.g. "Mike do X" → "do X")
 *   3. fromMe + not isMain → skip (own echoes in other chats)
 *   4. requiresTrigger (groups) → require @mention prefix (e.g. "@Mike do X" → "do X")
 *   5. Otherwise → process as-is
 */
export function shouldProcessMessage(
  config: BotConfig,
  input: MessageFilterInput,
): { process: true; text: string | null } | { process: false } {
  const chat =
    config.registeredChats[input.chatJid] ??
    config.registeredChats[canonicalizeJid(input.chatJid)];

  // Not registered
  if (!chat) {
    return { process: false };
  }

  // Own messages
  if (input.fromMe) {
    if (!chat.isMain) {
      return { process: false };
    }
    // Self-chat: require assistant name prefix
    if (!input.text) {
      return { process: false };
    }
    const stripped = stripNameTrigger(config, input.text);
    if (stripped === null) {
      return { process: false };
    }
    return { process: true, text: stripped || null };
  }

  // Group mention trigger
  if (chat.requiresTrigger) {
    if (!input.text) {
      return { process: false };
    }
    const stripped = stripMentionTrigger(config, input.text);
    if (stripped === null) {
      return { process: false };
    }
    return { process: true, text: stripped || null };
  }

  // No trigger required, not fromMe
  return { process: true, text: input.text };
}
