/**
 * Baileys WhatsApp connection bootstrap.
 *
 * Called from src/instrumentation.ts on server start (Node.js runtime only).
 *
 * Wires up:
 *   1. Baileys socket creation + multi-file auth persistence
 *   2. Auto-reconnect on disconnect (unless logged out)
 *   3. Bot-config-aware message filtering (registered chats, triggers, self-chat)
 *   4. LID → phone-number JID translation for self-chat consistency
 *   5. Inbound message handler (normalize → filter → dispatch to Manus)
 *   6. Runtime adapter registration (so webhook routes can send outbound)
 *
 * QR code pairing is handled separately by src/scripts/whatsapp-auth.ts.
 * Chat registration is handled by src/scripts/whatsapp-setup.ts.
 *
 * Uses globalThis to survive Next.js dev-mode hot reloads.
 */

import {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";

import { getEnv } from "@/lib/env";
import { createManusClientFromEnv } from "@/lib/manus/client";
import { dispatchInboundMessage } from "@/lib/orchestration/inbound-dispatch";
import { DrizzleEventProcessorStore } from "@/lib/orchestration/event-processor.store";
import { DrizzleTaskCreationStore } from "@/lib/orchestration/task-creation.store";
import { DrizzleTaskRouterStore } from "@/lib/routing/task-router.store";
import { createTaskRouterFromEnv } from "@/lib/routing/task-router-runtime";

import { canonicalizeJid, loadBotConfig, shouldProcessMessage } from "./bot-config";
import type { BotConfig } from "./bot-config";
import { downloadBaileysMediaBuffer } from "./whatsapp-baileys";
import { SlidingWindowRateLimiter } from "./rate-limiter";
import { getRuntimeWhatsAppAdapter, setRuntimeWhatsAppAdapter } from "./runtime-adapter";
import { BaileysWhatsAppAdapter } from "./whatsapp-adapter";
import { createWhatsAppInboundHandler } from "./whatsapp-inbound";
import { DrizzleWhatsAppInboundStore } from "./whatsapp-inbound.store";

const logger = pino({ level: "info" });

// ---------------------------------------------------------------------------
// globalThis singleton to survive Next.js dev-mode hot reloads
// ---------------------------------------------------------------------------

interface BaileysGlobalState {
  socket: ReturnType<typeof makeWASocket> | null;
  connected: boolean;
  booted: boolean;
}

declare global {
  var __manus_whatsapp_baileys__: BaileysGlobalState | undefined;
}

const getGlobal = (): BaileysGlobalState => {
  if (!globalThis.__manus_whatsapp_baileys__) {
    globalThis.__manus_whatsapp_baileys__ = { socket: null, connected: false, booted: false };
  }
  return globalThis.__manus_whatsapp_baileys__;
};

// ---------------------------------------------------------------------------
// LID → phone-number JID translation
// ---------------------------------------------------------------------------

/**
 * Baileys sometimes reports the sender of self-chat messages using a
 * "LID" JID (e.g. `123:45@lid`) instead of the phone-number JID
 * (`6581234567@s.whatsapp.net`).  This map is populated from the
 * `creds.me` object so we can normalise back to the phone JID.
 */
let lidToPhoneJid: Map<string, string> = new Map();

function resolveJid(jid: string): string {
  const canonical = canonicalizeJid(jid);
  const mapped = lidToPhoneJid.get(jid) ?? lidToPhoneJid.get(canonical);
  return canonicalizeJid(mapped ?? canonical);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export async function bootBaileys(): Promise<void> {
  const state = getGlobal();
  const runtimeAdapter = getRuntimeWhatsAppAdapter();
  if (state.booted && runtimeAdapter) {
    logger.info("Baileys already booted (dev hot reload), skipping");
    return;
  }

  if (state.booted && !runtimeAdapter) {
    logger.warn("Baileys marked booted but runtime adapter missing; retrying bootstrap");
    state.booted = false;
  }

  const env = getEnv();

  // --- Bot config ---
  const botConfig: BotConfig | null = loadBotConfig(env.WHATSAPP_AUTH_DIR);

  if (!botConfig) {
    logger.warn(
      { authDir: env.WHATSAPP_AUTH_DIR },
      "No bot-config.json found — WhatsApp connection skipped. Run `npm run whatsapp:setup` to configure.",
    );
    return;
  }

  state.booted = true;

  logger.info(
    {
      assistantName: botConfig.assistantName,
      mainChannel: botConfig.mainChannel.jid,
      registeredChats: Object.keys(botConfig.registeredChats).length,
    },
    "Bot config loaded",
  );

  // --- Auth ---
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Baileys utility, not a React hook
  const { state: authState, saveCreds } = await useMultiFileAuthState(env.WHATSAPP_AUTH_DIR);

  // --- Adapter ---
  const adapter = new BaileysWhatsAppAdapter({
    getSocket: () => state.socket,
    isConnected: () => state.connected,
  });
  setRuntimeWhatsAppAdapter(adapter);

  // --- Inbound handler ---
  const inboundStore = new DrizzleWhatsAppInboundStore();
  const rateLimiter = new SlidingWindowRateLimiter({
    maxHits: 30,
    windowMs: 60_000,
  });

  const inboundHandler = createWhatsAppInboundHandler({
    store: inboundStore,
    downloadMedia: downloadBaileysMediaBuffer,
    rateLimiter,
  });

  // --- Orchestration deps (created once, reused across messages) ---
  const manusClient = createManusClientFromEnv();
  const taskCreationStore = new DrizzleTaskCreationStore();
  const eventProcessorStore = new DrizzleEventProcessorStore();
  const taskRouterStore = new DrizzleTaskRouterStore();
  const router = createTaskRouterFromEnv({ store: taskRouterStore });

  // --- Connect ---
  const connect = (): void => {
    const socket = makeWASocket({
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, logger),
      },
      logger,
    });

    state.socket = socket;

    // --- Credential persistence ---
    socket.ev.on("creds.update", saveCreds);

    // --- Connection lifecycle ---
    socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        state.connected = true;
        logger.info("WhatsApp connection established");

        // Populate LID → phone JID mapping from credentials
        const me = authState.creds.me;
        if (me) {
          lidToPhoneJid = new Map();
          // me.id is the phone JID (e.g. 6581234567:12@s.whatsapp.net)
          // me.lid is the LID JID (e.g. 123:45@lid)
          const phoneJid = canonicalizeJid(me.id);
          if (me.lid) {
            lidToPhoneJid.set(me.lid, phoneJid);
            lidToPhoneJid.set(canonicalizeJid(me.lid), phoneJid);
            logger.info({ lid: me.lid, phoneJid }, "LID → phone JID mapping registered");
          }
        }

        adapter.flushOutgoingQueue().catch((err: unknown) => {
          logger.error({ err }, "Failed to flush outgoing queue on reconnect");
        });
      }

      if (connection === "close") {
        state.connected = false;
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          logger.warn("WhatsApp logged out — run `npm run whatsapp:auth` to re-pair");
          return;
        }

        logger.info({ statusCode }, "WhatsApp disconnected, reconnecting...");
        setTimeout(connect, 3_000);
      }
    });

    // --- Inbound messages ---
    socket.ev.on("messages.upsert", async ({ messages: inboundMessages, type }) => {
      if (type !== "notify" && type !== "append") {
        return;
      }

      for (const msg of inboundMessages) {
        try {
          const fromMe = Boolean(msg.key.fromMe);
          const rawChatJid = msg.key.remoteJid?.trim();

          if (!rawChatJid) {
            continue;
          }

          // Resolve LID-based JIDs to phone-number JIDs
          const chatJid = resolveJid(rawChatJid);

          // Extract text early for trigger detection
          const rawText = extractRawText(msg.message as Record<string, unknown> | null | undefined);

          // --- Bot config filtering ---
          const filterResult = shouldProcessMessage(botConfig, {
            chatJid,
            text: rawText,
            fromMe,
          });

          if (!filterResult.process) {
            continue;
          }

          const result = await inboundHandler.handle(msg as never);

          if (!result) {
            continue;
          }

          if (result.status === "rate_limited") {
            logger.warn({ channelMessageId: result.channelMessageId }, "Inbound rate-limited");
            continue;
          }

          if (result.status === "duplicate") {
            logger.debug({ channelMessageId: result.channelMessageId }, "Inbound deduplicated");
            continue;
          }

          // Use the (possibly trigger-stripped) text from the filter result
          const processedText = filterResult.text;

          // result.status === "stored" — dispatch to Manus
          await adapter.setTyping(result.normalized.chatId, true);

          await dispatchInboundMessage(
            {
              sessionId: result.sessionId,
              inboundMessageId: result.messageId,
              chatId: result.normalized.chatId,
              senderId: result.normalized.senderId,
              text: processedText,
              attachments: result.normalized.attachments,
              agentProfile: env.MANUS_AGENT_PROFILE,
            },
            {
              activeTaskStore: taskRouterStore,
              router,
              manusClient,
              taskStateStore: eventProcessorStore,
              whatsappAdapter: adapter,
              taskCreationStore,
            },
          );

          await adapter.setTyping(result.normalized.chatId, false);
        } catch (err) {
          logger.error(
            { err, messageId: msg.key.id, chatId: msg.key.remoteJid },
            "Failed to process inbound message",
          );
        }
      }
    });
  };

  logger.info({ authDir: env.WHATSAPP_AUTH_DIR }, "Booting Baileys WhatsApp connection...");
  connect();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Quick text extraction from a raw Baileys message for trigger detection.
 * This mirrors the logic in `whatsapp-inbound.ts`'s `textFromMessage`
 * but operates on the raw wire message before normalisation.
 */
function extractRawText(
  message: Record<string, unknown> | null | undefined,
): string | null {
  if (!message) return null;

  const conversation = message.conversation;
  if (typeof conversation === "string" && conversation.trim()) {
    return conversation.trim();
  }

  const ext = message.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text?.trim()) {
    return ext.text.trim();
  }

  const img = message.imageMessage as { caption?: string } | undefined;
  if (img?.caption?.trim()) {
    return img.caption.trim();
  }

  const vid = message.videoMessage as { caption?: string } | undefined;
  if (vid?.caption?.trim()) {
    return vid.caption.trim();
  }

  const doc = message.documentMessage as { caption?: string } | undefined;
  if (doc?.caption?.trim()) {
    return doc.caption.trim();
  }

  const aud = message.audioMessage as { caption?: string } | undefined;
  if (aud?.caption?.trim()) {
    return aud.caption.trim();
  }

  return null;
}
