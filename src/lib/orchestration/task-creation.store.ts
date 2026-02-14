import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { manusTasks, messages } from "@/db/schema";

export interface CreateTaskRecordInput {
  sessionId: string;
  taskId: string;
  createdByMessageId: string;
  agentProfile: string;
  taskTitle: string | null;
  taskUrl: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface LinkInboundMessageToTaskInput {
  messageId: string;
  taskId: string;
  routeReason: string;
}

export interface CreateOutboundMessageInput {
  sessionId: string;
  senderId: string;
  contentText: string;
  contentJson: Record<string, unknown>;
  manusTaskId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface TaskCreationStore {
  createTaskRecord(input: CreateTaskRecordInput): Promise<void>;
  linkInboundMessageToTask(input: LinkInboundMessageToTaskInput): Promise<void>;
  createOutboundMessage(input: CreateOutboundMessageInput): Promise<string>;
}

export class DrizzleTaskCreationStore implements TaskCreationStore {
  constructor(private readonly database: typeof db = db) {}

  async createTaskRecord(input: CreateTaskRecordInput): Promise<void> {
    await this.database.insert(manusTasks).values({
      sessionId: input.sessionId,
      taskId: input.taskId,
      status: "pending",
      stopReason: null,
      agentProfile: input.agentProfile,
      taskTitle: input.taskTitle,
      taskUrl: input.taskUrl,
      lastMessage: null,
      creditUsage: null,
      createdByMessageId: input.createdByMessageId,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      stoppedAt: null,
      expiresAt: input.expiresAt,
    });
  }

  async linkInboundMessageToTask(input: LinkInboundMessageToTaskInput): Promise<void> {
    const rows = await this.database
      .update(messages)
      .set({
        manusTaskId: input.taskId,
        routeAction: "new",
        routeReason: input.routeReason,
      })
      .where(eq(messages.id, input.messageId))
      .returning({ id: messages.id });

    if (!rows[0]) {
      throw new Error(`Inbound message not found for task linking: ${input.messageId}`);
    }
  }

  async createOutboundMessage(input: CreateOutboundMessageInput): Promise<string> {
    const rows = await this.database
      .insert(messages)
      .values({
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
      throw new Error("Failed to insert outbound acknowledgement message");
    }

    return message.id;
  }
}
