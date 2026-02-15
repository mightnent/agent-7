import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const channelEnum = pgEnum("channel", ["whatsapp"]);
export const sessionStatusEnum = pgEnum("session_status", ["active", "closed", "expired"]);
export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);
export const routeActionEnum = pgEnum("route_action", ["continue", "new"]);
export const taskStatusEnum = pgEnum("task_status", ["pending", "running", "completed", "failed", "waiting_user"]);
export const stopReasonEnum = pgEnum("stop_reason", ["finish", "ask"]);
export const webhookEventTypeEnum = pgEnum("webhook_event_type", ["task_created", "task_progress", "task_stopped"]);
export const webhookProcessStatusEnum = pgEnum("webhook_process_status", [
  "pending",
  "processed",
  "ignored",
  "failed",
]);
export const DEFAULT_WORKSPACE_ID = "00000000-0000-0000-0000-000000000000";

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  planTier: text("plan_tier").notNull().default("oss"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const channelSessions = pgTable(
  "channel_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .default(sql.raw(`'${DEFAULT_WORKSPACE_ID}'::uuid`))
      .references(() => workspaces.id, { onDelete: "restrict" }),
    channel: channelEnum("channel").notNull().default("whatsapp"),
    channelUserId: text("channel_user_id").notNull(),
    channelChatId: text("channel_chat_id").notNull(),
    status: sessionStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("channel_sessions_workspace_channel_chat_user_unique").on(
      t.workspaceId,
      t.channel,
      t.channelChatId,
      t.channelUserId,
    ),
    index("channel_sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .default(sql.raw(`'${DEFAULT_WORKSPACE_ID}'::uuid`))
      .references(() => workspaces.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => channelSessions.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    channelMessageId: text("channel_message_id"),
    senderId: text("sender_id").notNull(),
    contentText: text("content_text"),
    contentJson: jsonb("content_json"),
    manusTaskId: text("manus_task_id"),
    routeAction: routeActionEnum("route_action"),
    routeReason: text("route_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("messages_workspace_session_created_at_idx").on(t.workspaceId, t.sessionId, t.createdAt),
    index("messages_session_created_at_idx").on(t.sessionId, t.createdAt),
    uniqueIndex("messages_channel_message_id_unique")
      .on(t.channelMessageId)
      .where(sql`${t.channelMessageId} is not null`),
    index("messages_manus_task_id_idx").on(t.manusTaskId),
    index("messages_expires_at_idx").on(t.expiresAt),
  ],
);

export const manusTasks = pgTable(
  "manus_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .default(sql.raw(`'${DEFAULT_WORKSPACE_ID}'::uuid`))
      .references(() => workspaces.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => channelSessions.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull().unique(),
    status: taskStatusEnum("status").notNull().default("pending"),
    stopReason: stopReasonEnum("stop_reason"),
    agentProfile: text("agent_profile").notNull().default("manus-1.6"),
    taskTitle: text("task_title"),
    taskUrl: text("task_url"),
    lastMessage: text("last_message"),
    creditUsage: integer("credit_usage"),
    createdByMessageId: uuid("created_by_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("manus_tasks_workspace_status_updated_at_idx").on(t.workspaceId, t.status, t.updatedAt),
    index("manus_tasks_session_created_at_idx").on(t.sessionId, t.createdAt),
    index("manus_tasks_status_updated_at_idx").on(t.status, t.updatedAt),
    index("manus_tasks_expires_at_idx").on(t.expiresAt),
  ],
);

export const manusWebhookEvents = pgTable(
  "manus_webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .default(sql.raw(`'${DEFAULT_WORKSPACE_ID}'::uuid`))
      .references(() => workspaces.id, { onDelete: "restrict" }),
    eventId: text("event_id").notNull().unique(),
    eventType: webhookEventTypeEnum("event_type").notNull(),
    taskId: text("task_id").notNull(),
    progressType: text("progress_type"),
    stopReason: stopReasonEnum("stop_reason"),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processStatus: webhookProcessStatusEnum("process_status").notNull().default("pending"),
    error: text("error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("manus_webhook_events_workspace_task_received_idx").on(t.workspaceId, t.taskId, t.receivedAt),
    index("manus_webhook_events_task_received_idx").on(t.taskId, t.receivedAt),
    index("manus_webhook_events_status_received_idx").on(t.processStatus, t.receivedAt),
    index("manus_webhook_events_expires_at_idx").on(t.expiresAt),
  ],
);

export const manusAttachments = pgTable(
  "manus_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .default(sql.raw(`'${DEFAULT_WORKSPACE_ID}'::uuid`))
      .references(() => workspaces.id, { onDelete: "restrict" }),
    taskId: text("task_id").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => manusWebhookEvents.eventId, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    url: text("url").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    mimeType: text("mime_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("manus_attachments_workspace_task_id_idx").on(t.workspaceId, t.taskId),
    index("manus_attachments_task_id_idx").on(t.taskId),
    index("manus_attachments_expires_at_idx").on(t.expiresAt),
  ],
);
