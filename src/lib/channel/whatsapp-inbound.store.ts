import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { channelSessions, messages } from "@/db/schema";

export interface UpsertSessionInput {
  channelUserId: string;
  channelChatId: string;
  lastActivityAt: Date;
  expiresAt: Date;
}

export interface UpsertSessionResult {
  id: string;
}

export interface PersistInboundMessageInput {
  sessionId: string;
  channelMessageId: string;
  senderId: string;
  contentText: string | null;
  contentJson: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

export interface PersistInboundMessageResult {
  inserted: boolean;
  id: string | null;
}

export interface WhatsAppInboundStore {
  hasMessage(channelMessageId: string): Promise<boolean>;
  upsertSession(input: UpsertSessionInput): Promise<UpsertSessionResult>;
  persistInboundMessage(input: PersistInboundMessageInput): Promise<PersistInboundMessageResult>;
}

export class DrizzleWhatsAppInboundStore implements WhatsAppInboundStore {
  constructor(private readonly database: typeof db = db) {}

  async hasMessage(channelMessageId: string): Promise<boolean> {
    const existing = await this.database
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.channelMessageId, channelMessageId))
      .limit(1);

    return existing.length > 0;
  }

  async upsertSession(input: UpsertSessionInput): Promise<UpsertSessionResult> {
    const rows = await this.database
      .insert(channelSessions)
      .values({
        channel: "whatsapp",
        channelUserId: input.channelUserId,
        channelChatId: input.channelChatId,
        status: "active",
        lastActivityAt: input.lastActivityAt,
        updatedAt: input.lastActivityAt,
        expiresAt: input.expiresAt,
      })
      .onConflictDoUpdate({
        target: [channelSessions.channel, channelSessions.channelChatId, channelSessions.channelUserId],
        set: {
          status: "active",
          lastActivityAt: input.lastActivityAt,
          updatedAt: input.lastActivityAt,
          expiresAt: input.expiresAt,
        },
      })
      .returning({ id: channelSessions.id });

    const session = rows[0];
    if (!session) {
      throw new Error("Failed to upsert channel session");
    }

    return session;
  }

  async persistInboundMessage(input: PersistInboundMessageInput): Promise<PersistInboundMessageResult> {
    const rows = await this.database
      .insert(messages)
      .values({
        sessionId: input.sessionId,
        direction: "inbound",
        channelMessageId: input.channelMessageId,
        senderId: input.senderId,
        contentText: input.contentText,
        contentJson: input.contentJson,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });

    if (!rows[0]) {
      return { inserted: false, id: null };
    }

    return { inserted: true, id: rows[0].id };
  }

  async getSessionId(channelUserId: string, channelChatId: string): Promise<string | null> {
    const rows = await this.database
      .select({ id: channelSessions.id })
      .from(channelSessions)
      .where(
        and(
          eq(channelSessions.channel, "whatsapp"),
          eq(channelSessions.channelUserId, channelUserId),
          eq(channelSessions.channelChatId, channelChatId),
        ),
      )
      .limit(1);

    return rows[0]?.id ?? null;
  }
}
