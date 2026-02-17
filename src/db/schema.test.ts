import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  agentMemories,
  channelEnum,
  channelSessions,
  manusAttachments,
  manusTasks,
  manusWebhookEvents,
  messages,
  routeActionEnum,
  stopReasonEnum,
  taskStatusEnum,
  whatsappAuthKeys,
  webhookEventTypeEnum,
  workspaceChannels,
  workspaceSettings,
  workspaces,
} from "./schema";

describe("db schema", () => {
  it("defines the expected table names", () => {
    expect(getTableName(channelSessions)).toBe("channel_sessions");
    expect(getTableName(workspaces)).toBe("workspaces");
    expect(getTableName(messages)).toBe("messages");
    expect(getTableName(manusTasks)).toBe("manus_tasks");
    expect(getTableName(manusWebhookEvents)).toBe("manus_webhook_events");
    expect(getTableName(manusAttachments)).toBe("manus_attachments");
    expect(getTableName(workspaceSettings)).toBe("workspace_settings");
    expect(getTableName(workspaceChannels)).toBe("workspace_channels");
    expect(getTableName(whatsappAuthKeys)).toBe("whatsapp_auth_keys");
    expect(getTableName(agentMemories)).toBe("agent_memories");
  });

  it("defines expected enum values", () => {
    expect(channelEnum.enumValues).toEqual(["whatsapp"]);
    expect(routeActionEnum.enumValues).toEqual(["continue", "new", "respond"]);
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
