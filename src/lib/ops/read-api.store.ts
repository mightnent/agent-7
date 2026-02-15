import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { DEFAULT_WORKSPACE_ID, channelSessions, manusTasks, messages } from "@/db/schema";

export interface SessionView {
  id: string;
  channel: "whatsapp";
  channelUserId: string;
  channelChatId: string;
  status: "active" | "closed" | "expired";
  lastActivityAt: Date;
  updatedAt: Date;
  createdAt: Date;
  recentTasks: Array<{
    taskId: string;
    status: "pending" | "running" | "completed" | "failed" | "waiting_user";
    taskTitle: string | null;
    updatedAt: Date;
  }>;
  recentMessages: Array<{
    id: string;
    direction: "inbound" | "outbound";
    contentText: string | null;
    manusTaskId: string | null;
    createdAt: Date;
  }>;
}

export interface TaskView {
  id: string;
  sessionId: string;
  status: "pending" | "running" | "completed" | "failed" | "waiting_user";
  stopReason: "finish" | "ask" | null;
  taskTitle: string | null;
  taskUrl: string | null;
  lastMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  stoppedAt: Date | null;
  relatedMessages: Array<{
    id: string;
    direction: "inbound" | "outbound";
    contentText: string | null;
    createdAt: Date;
  }>;
}

export class DrizzleReadApiStore {
  constructor(private readonly database: typeof db = db) {}

  async getSessionView(sessionId: string): Promise<SessionView | null> {
    const sessionRows = await this.database
      .select({
        id: channelSessions.id,
        channel: channelSessions.channel,
        channelUserId: channelSessions.channelUserId,
        channelChatId: channelSessions.channelChatId,
        status: channelSessions.status,
        lastActivityAt: channelSessions.lastActivityAt,
        updatedAt: channelSessions.updatedAt,
        createdAt: channelSessions.createdAt,
      })
      .from(channelSessions)
      .where(and(eq(channelSessions.workspaceId, DEFAULT_WORKSPACE_ID), eq(channelSessions.id, sessionId)))
      .limit(1);

    const session = sessionRows[0];
    if (!session) {
      return null;
    }

    const recentTasks = await this.database
      .select({
        taskId: manusTasks.taskId,
        status: manusTasks.status,
        taskTitle: manusTasks.taskTitle,
        updatedAt: manusTasks.updatedAt,
      })
      .from(manusTasks)
      .where(and(eq(manusTasks.workspaceId, DEFAULT_WORKSPACE_ID), eq(manusTasks.sessionId, session.id)))
      .orderBy(desc(manusTasks.updatedAt))
      .limit(20);

    const recentMessages = await this.database
      .select({
        id: messages.id,
        direction: messages.direction,
        contentText: messages.contentText,
        manusTaskId: messages.manusTaskId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(eq(messages.workspaceId, DEFAULT_WORKSPACE_ID), eq(messages.sessionId, session.id)))
      .orderBy(desc(messages.createdAt))
      .limit(50);

    return {
      ...session,
      recentTasks,
      recentMessages,
    };
  }

  async getTaskView(taskId: string): Promise<TaskView | null> {
    const taskRows = await this.database
      .select({
        id: manusTasks.taskId,
        sessionId: manusTasks.sessionId,
        status: manusTasks.status,
        stopReason: manusTasks.stopReason,
        taskTitle: manusTasks.taskTitle,
        taskUrl: manusTasks.taskUrl,
        lastMessage: manusTasks.lastMessage,
        createdAt: manusTasks.createdAt,
        updatedAt: manusTasks.updatedAt,
        stoppedAt: manusTasks.stoppedAt,
      })
      .from(manusTasks)
      .where(and(eq(manusTasks.workspaceId, DEFAULT_WORKSPACE_ID), eq(manusTasks.taskId, taskId)))
      .limit(1);

    const task = taskRows[0];
    if (!task) {
      return null;
    }

    const relatedMessages = await this.database
      .select({
        id: messages.id,
        direction: messages.direction,
        contentText: messages.contentText,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(eq(messages.workspaceId, DEFAULT_WORKSPACE_ID), eq(messages.manusTaskId, task.id)))
      .orderBy(desc(messages.createdAt))
      .limit(100);

    return {
      ...task,
      relatedMessages,
    };
  }
}
