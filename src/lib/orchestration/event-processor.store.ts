import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { DEFAULT_WORKSPACE_ID, channelSessions, manusAttachments, manusTasks, manusWebhookEvents, messages } from "@/db/schema";

export interface InsertWebhookEventInput {
  eventId: string;
  eventType: "task_created" | "task_progress" | "task_stopped";
  taskId: string;
  progressType: string | null;
  stopReason: "finish" | "ask" | null;
  payload: Record<string, unknown>;
  receivedAt: Date;
  expiresAt: Date;
}

export interface TaskDeliveryContext {
  sessionId: string;
  chatId: string;
}

export interface CreateOutboundMessageInput {
  sessionId: string;
  manusTaskId: string;
  senderId: string;
  contentText: string;
  contentJson: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

export interface AttachmentRecordInput {
  taskId: string;
  eventId: string;
  fileName: string;
  url: string;
  sizeBytes: bigint;
  mimeType: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface EventProcessorStore {
  getTaskDeliveryContext(taskId: string): Promise<TaskDeliveryContext | null>;
  getTaskStatus(taskId: string): Promise<"pending" | "running" | "completed" | "failed" | "waiting_user" | null>;
  updateTaskFromCreated(input: { taskId: string; taskTitle: string | null; taskUrl: string | null; updatedAt: Date }): Promise<void>;
  updateTaskFromProgress(input: { taskId: string; message: string | null; updatedAt: Date }): Promise<void>;
  updateTaskFromStoppedFinish(input: {
    taskId: string;
    taskTitle: string | null;
    taskUrl: string | null;
    message: string | null;
    updatedAt: Date;
    stoppedAt: Date;
  }): Promise<void>;
  updateTaskFromStoppedAsk(input: {
    taskId: string;
    taskTitle: string | null;
    taskUrl: string | null;
    message: string | null;
    updatedAt: Date;
  }): Promise<void>;
  createOutboundMessage(input: CreateOutboundMessageInput): Promise<string>;
  createAttachmentRecords(input: AttachmentRecordInput[]): Promise<void>;
}

export interface WebhookEventLifecycleStore {
  insertWebhookEventIfNew(input: InsertWebhookEventInput): Promise<boolean>;
  markWebhookEventProcessed(eventId: string, processedAt: Date): Promise<void>;
  markWebhookEventFailed(eventId: string, processedAt: Date, error: string): Promise<void>;
}

export class DrizzleEventProcessorStore implements EventProcessorStore, WebhookEventLifecycleStore {
  constructor(private readonly database: typeof db = db) {}

  async insertWebhookEventIfNew(input: InsertWebhookEventInput): Promise<boolean> {
    const rows = await this.database
      .insert(manusWebhookEvents)
      .values({
        workspaceId: DEFAULT_WORKSPACE_ID,
        eventId: input.eventId,
        eventType: input.eventType,
        taskId: input.taskId,
        progressType: input.progressType,
        stopReason: input.stopReason,
        payload: input.payload,
        receivedAt: input.receivedAt,
        processedAt: null,
        processStatus: "pending",
        error: null,
        expiresAt: input.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: manusWebhookEvents.id });

    return Boolean(rows[0]);
  }

  async markWebhookEventProcessed(eventId: string, processedAt: Date): Promise<void> {
    await this.database
      .update(manusWebhookEvents)
      .set({
        processStatus: "processed",
        processedAt,
        error: null,
      })
      .where(and(eq(manusWebhookEvents.workspaceId, DEFAULT_WORKSPACE_ID), eq(manusWebhookEvents.eventId, eventId)));
  }

  async markWebhookEventFailed(eventId: string, processedAt: Date, error: string): Promise<void> {
    await this.database
      .update(manusWebhookEvents)
      .set({
        processStatus: "failed",
        processedAt,
        error,
      })
      .where(and(eq(manusWebhookEvents.workspaceId, DEFAULT_WORKSPACE_ID), eq(manusWebhookEvents.eventId, eventId)));
  }

  async getTaskDeliveryContext(taskId: string): Promise<TaskDeliveryContext | null> {
    const rows = await this.database
      .select({
        sessionId: manusTasks.sessionId,
        chatId: channelSessions.channelChatId,
      })
      .from(manusTasks)
      .innerJoin(channelSessions, eq(channelSessions.id, manusTasks.sessionId))
      .where(and(eq(manusTasks.workspaceId, DEFAULT_WORKSPACE_ID), eq(manusTasks.taskId, taskId)))
      .limit(1);

    return rows[0] ?? null;
  }

  async getTaskStatus(taskId: string): Promise<"pending" | "running" | "completed" | "failed" | "waiting_user" | null> {
    const rows = await this.database
      .select({ status: manusTasks.status })
      .from(manusTasks)
      .where(and(eq(manusTasks.workspaceId, DEFAULT_WORKSPACE_ID), eq(manusTasks.taskId, taskId)))
      .limit(1);

    return rows[0]?.status ?? null;
  }

  async updateTaskFromCreated(input: {
    taskId: string;
    taskTitle: string | null;
    taskUrl: string | null;
    updatedAt: Date;
  }): Promise<void> {
    await this.database
      .update(manusTasks)
      .set({
        status: "running",
        taskTitle: input.taskTitle,
        taskUrl: input.taskUrl,
        updatedAt: input.updatedAt,
      })
      .where(and(eq(manusTasks.workspaceId, DEFAULT_WORKSPACE_ID), eq(manusTasks.taskId, input.taskId)));
  }

  async updateTaskFromProgress(input: { taskId: string; message: string | null; updatedAt: Date }): Promise<void> {
    await this.database
      .update(manusTasks)
      .set({
        status: "running",
        lastMessage: input.message,
        updatedAt: input.updatedAt,
      })
      .where(and(eq(manusTasks.workspaceId, DEFAULT_WORKSPACE_ID), eq(manusTasks.taskId, input.taskId)));
  }

  async updateTaskFromStoppedFinish(input: {
    taskId: string;
    taskTitle: string | null;
    taskUrl: string | null;
    message: string | null;
    updatedAt: Date;
    stoppedAt: Date;
  }): Promise<void> {
    await this.database
      .update(manusTasks)
      .set({
        status: "completed",
        stopReason: "finish",
        taskTitle: input.taskTitle,
        taskUrl: input.taskUrl,
        lastMessage: input.message,
        updatedAt: input.updatedAt,
        stoppedAt: input.stoppedAt,
      })
      .where(and(eq(manusTasks.workspaceId, DEFAULT_WORKSPACE_ID), eq(manusTasks.taskId, input.taskId)));
  }

  async updateTaskFromStoppedAsk(input: {
    taskId: string;
    taskTitle: string | null;
    taskUrl: string | null;
    message: string | null;
    updatedAt: Date;
  }): Promise<void> {
    await this.database
      .update(manusTasks)
      .set({
        status: "waiting_user",
        stopReason: "ask",
        taskTitle: input.taskTitle,
        taskUrl: input.taskUrl,
        lastMessage: input.message,
        updatedAt: input.updatedAt,
      })
      .where(and(eq(manusTasks.workspaceId, DEFAULT_WORKSPACE_ID), eq(manusTasks.taskId, input.taskId)));
  }

  async createOutboundMessage(input: CreateOutboundMessageInput): Promise<string> {
    const rows = await this.database
      .insert(messages)
      .values({
        workspaceId: DEFAULT_WORKSPACE_ID,
        sessionId: input.sessionId,
        direction: "outbound",
        channelMessageId: null,
        senderId: input.senderId,
        contentText: input.contentText,
        contentJson: input.contentJson,
        manusTaskId: input.manusTaskId,
        routeAction: null,
        routeReason: null,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      })
      .returning({ id: messages.id });

    const message = rows[0];
    if (!message) {
      throw new Error("Failed to create outbound message record");
    }

    return message.id;
  }

  async createAttachmentRecords(input: AttachmentRecordInput[]): Promise<void> {
    if (input.length === 0) {
      return;
    }

    await this.database.insert(manusAttachments).values(
      input.map((attachment) => ({
        workspaceId: DEFAULT_WORKSPACE_ID,
        taskId: attachment.taskId,
        eventId: attachment.eventId,
        fileName: attachment.fileName,
        url: attachment.url,
        sizeBytes: attachment.sizeBytes,
        mimeType: attachment.mimeType,
        createdAt: attachment.createdAt,
        expiresAt: attachment.expiresAt,
      })),
    );
  }

  async markTaskRunning(taskId: string, updatedAt: Date): Promise<void> {
    await this.database
      .update(manusTasks)
      .set({
        status: "running",
        updatedAt,
      })
      .where(
        and(
          eq(manusTasks.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(manusTasks.taskId, taskId),
          eq(manusTasks.status, "waiting_user"),
        ),
      );
  }
}
