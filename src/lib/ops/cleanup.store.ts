import { and, eq, inArray, lt } from "drizzle-orm";

import { db } from "@/db/client";
import { channelSessions, manusAttachments, manusTasks, manusWebhookEvents, messages } from "@/db/schema";

export type ExpirableTable = "channel_sessions" | "messages" | "manus_tasks" | "manus_webhook_events" | "manus_attachments";

export interface StaleTaskRecord {
  taskId: string;
  sessionId: string;
  chatId: string;
}

export interface CleanupStore {
  deleteExpiredRows(table: ExpirableTable, now: Date, batchSize: number): Promise<number>;
  listStaleTasks(cutoff: Date): Promise<StaleTaskRecord[]>;
  markTaskFailed(taskId: string, now: Date, reason: string): Promise<boolean>;
  createStaleTaskOutboundMessage(input: {
    sessionId: string;
    taskId: string;
    contentText: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void>;
}

export const cleanupTableOrder: ExpirableTable[] = [
  "messages",
  "manus_attachments",
  "manus_webhook_events",
  "manus_tasks",
  "channel_sessions",
];

export class DrizzleCleanupStore implements CleanupStore {
  constructor(private readonly database: typeof db = db) {}

  async deleteExpiredRows(table: ExpirableTable, now: Date, batchSize: number): Promise<number> {
    if (table === "messages") {
      const ids = await this.database.select({ id: messages.id }).from(messages).where(lt(messages.expiresAt, now)).limit(batchSize);
      if (ids.length === 0) return 0;
      const deleted = await this.database.delete(messages).where(inArray(messages.id, ids.map((row) => row.id))).returning({ id: messages.id });
      return deleted.length;
    }

    if (table === "manus_attachments") {
      const ids = await this.database
        .select({ id: manusAttachments.id })
        .from(manusAttachments)
        .where(lt(manusAttachments.expiresAt, now))
        .limit(batchSize);
      if (ids.length === 0) return 0;
      const deleted = await this.database
        .delete(manusAttachments)
        .where(inArray(manusAttachments.id, ids.map((row) => row.id)))
        .returning({ id: manusAttachments.id });
      return deleted.length;
    }

    if (table === "manus_webhook_events") {
      const ids = await this.database
        .select({ id: manusWebhookEvents.id })
        .from(manusWebhookEvents)
        .where(lt(manusWebhookEvents.expiresAt, now))
        .limit(batchSize);
      if (ids.length === 0) return 0;
      const deleted = await this.database
        .delete(manusWebhookEvents)
        .where(inArray(manusWebhookEvents.id, ids.map((row) => row.id)))
        .returning({ id: manusWebhookEvents.id });
      return deleted.length;
    }

    if (table === "manus_tasks") {
      const ids = await this.database.select({ id: manusTasks.id }).from(manusTasks).where(lt(manusTasks.expiresAt, now)).limit(batchSize);
      if (ids.length === 0) return 0;
      const deleted = await this.database.delete(manusTasks).where(inArray(manusTasks.id, ids.map((row) => row.id))).returning({ id: manusTasks.id });
      return deleted.length;
    }

    const ids = await this.database
      .select({ id: channelSessions.id })
      .from(channelSessions)
      .where(lt(channelSessions.expiresAt, now))
      .limit(batchSize);

    if (ids.length === 0) return 0;

    const deleted = await this.database
      .delete(channelSessions)
      .where(inArray(channelSessions.id, ids.map((row) => row.id)))
      .returning({ id: channelSessions.id });

    return deleted.length;
  }

  async listStaleTasks(cutoff: Date): Promise<StaleTaskRecord[]> {
    const rows = await this.database
      .select({
        taskId: manusTasks.taskId,
        sessionId: manusTasks.sessionId,
        chatId: channelSessions.channelChatId,
      })
      .from(manusTasks)
      .innerJoin(channelSessions, eq(channelSessions.id, manusTasks.sessionId))
      .where(and(inArray(manusTasks.status, ["pending", "running"]), lt(manusTasks.updatedAt, cutoff)));

    return rows;
  }

  async markTaskFailed(taskId: string, now: Date, reason: string): Promise<boolean> {
    const rows = await this.database
      .update(manusTasks)
      .set({
        status: "failed",
        stopReason: null,
        lastMessage: reason,
        updatedAt: now,
        stoppedAt: now,
      })
      .where(and(eq(manusTasks.taskId, taskId), inArray(manusTasks.status, ["pending", "running"])))
      .returning({ id: manusTasks.id });

    return Boolean(rows[0]);
  }

  async createStaleTaskOutboundMessage(input: {
    sessionId: string;
    taskId: string;
    contentText: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.database.insert(messages).values({
      sessionId: input.sessionId,
      direction: "outbound",
      channelMessageId: null,
      senderId: "assistant",
      contentText: input.contentText,
      contentJson: {
        provider: "whatsapp",
        type: "task_timeout",
      },
      manusTaskId: input.taskId,
      routeAction: null,
      routeReason: null,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
    });
  }
}
