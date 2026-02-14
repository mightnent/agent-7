import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  channelEnum,
  channelSessions,
  manusAttachments,
  manusTasks,
  manusWebhookEvents,
  messages,
  routeActionEnum,
  stopReasonEnum,
  taskStatusEnum,
  webhookEventTypeEnum,
} from "./schema";

describe("db schema", () => {
  it("defines the expected table names", () => {
    expect(getTableName(channelSessions)).toBe("channel_sessions");
    expect(getTableName(messages)).toBe("messages");
    expect(getTableName(manusTasks)).toBe("manus_tasks");
    expect(getTableName(manusWebhookEvents)).toBe("manus_webhook_events");
    expect(getTableName(manusAttachments)).toBe("manus_attachments");
  });

  it("defines expected enum values", () => {
    expect(channelEnum.enumValues).toEqual(["whatsapp"]);
    expect(routeActionEnum.enumValues).toEqual(["continue", "new"]);
    expect(stopReasonEnum.enumValues).toEqual(["finish", "ask"]);
    expect(taskStatusEnum.enumValues).toEqual([
      "pending",
      "running",
      "completed",
      "failed",
      "waiting_user",
    ]);
    expect(webhookEventTypeEnum.enumValues).toEqual([
      "task_created",
      "task_progress",
      "task_stopped",
    ]);
  });
});
