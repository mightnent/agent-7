import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { manusTasks, messages } from "@/db/schema";

import type { ActiveTaskForRouting, TaskRouterStore } from "./task-router";

export interface ActiveTaskQueryStore {
  listActiveTasks(sessionId: string): Promise<ActiveTaskForRouting[]>;
}

const isActiveStatus = (status: typeof manusTasks.$inferSelect.status): status is ActiveTaskForRouting["status"] => {
  return status === "pending" || status === "running" || status === "waiting_user";
};

export class DrizzleTaskRouterStore implements TaskRouterStore, ActiveTaskQueryStore {
  constructor(private readonly database: typeof db = db) {}

  async persistRouteDecision(input: {
    messageId: string;
    action: "continue" | "new";
    reason: string;
    taskId: string | null;
  }): Promise<void> {
    const rows = await this.database
      .update(messages)
      .set({
        routeAction: input.action,
        routeReason: input.reason,
        manusTaskId: input.taskId,
      })
      .where(eq(messages.id, input.messageId))
      .returning({ id: messages.id });

    if (!rows[0]) {
      throw new Error(`Inbound message not found for route persistence: ${input.messageId}`);
    }
  }

  async listActiveTasks(sessionId: string): Promise<ActiveTaskForRouting[]> {
    const rows = await this.database
      .select({
        taskId: manusTasks.taskId,
        taskTitle: manusTasks.taskTitle,
        status: manusTasks.status,
        stopReason: manusTasks.stopReason,
        lastMessage: manusTasks.lastMessage,
        originalPrompt: messages.contentText,
      })
      .from(manusTasks)
      .leftJoin(messages, eq(manusTasks.createdByMessageId, messages.id))
      .where(
        and(
          eq(manusTasks.sessionId, sessionId),
          inArray(manusTasks.status, ["pending", "running", "waiting_user"]),
        ),
      );

    return rows
      .filter((row) => isActiveStatus(row.status))
      .map((row) => ({
        taskId: row.taskId,
        taskTitle: row.taskTitle ?? "Untitled task",
        originalPrompt: row.originalPrompt ?? "",
        status: row.status as ActiveTaskForRouting["status"],
        stopReason: row.stopReason,
        lastMessage: row.lastMessage,
      }));
  }
}
