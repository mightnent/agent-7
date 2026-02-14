CREATE TYPE "public"."channel" AS ENUM('whatsapp');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."route_action" AS ENUM('continue', 'new');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'closed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."stop_reason" AS ENUM('finish', 'ask');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'running', 'completed', 'failed', 'waiting_user');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_type" AS ENUM('task_created', 'task_progress', 'task_stopped');--> statement-breakpoint
CREATE TYPE "public"."webhook_process_status" AS ENUM('pending', 'processed', 'ignored', 'failed');--> statement-breakpoint
CREATE TABLE "channel_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "channel" DEFAULT 'whatsapp' NOT NULL,
	"channel_user_id" text NOT NULL,
	"channel_chat_id" text NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manus_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"event_id" text NOT NULL,
	"file_name" text NOT NULL,
	"url" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manus_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"stop_reason" "stop_reason",
	"agent_profile" text DEFAULT 'manus-1.6' NOT NULL,
	"task_title" text,
	"task_url" text,
	"last_message" text,
	"credit_usage" integer,
	"created_by_message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manus_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_type" "webhook_event_type" NOT NULL,
	"task_id" text NOT NULL,
	"progress_type" text,
	"stop_reason" "stop_reason",
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"process_status" "webhook_process_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"channel_message_id" text,
	"sender_id" text NOT NULL,
	"content_text" text,
	"content_json" jsonb,
	"manus_task_id" text,
	"route_action" "route_action",
	"route_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manus_attachments" ADD CONSTRAINT "manus_attachments_event_id_manus_webhook_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."manus_webhook_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manus_tasks" ADD CONSTRAINT "manus_tasks_session_id_channel_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."channel_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manus_tasks" ADD CONSTRAINT "manus_tasks_created_by_message_id_messages_id_fk" FOREIGN KEY ("created_by_message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_channel_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."channel_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_sessions_channel_chat_user_unique" ON "channel_sessions" USING btree ("channel","channel_chat_id","channel_user_id");--> statement-breakpoint
CREATE INDEX "channel_sessions_expires_at_idx" ON "channel_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "manus_attachments_task_id_idx" ON "manus_attachments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "manus_attachments_expires_at_idx" ON "manus_attachments" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "manus_tasks_task_id_unique" ON "manus_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "manus_tasks_session_created_at_idx" ON "manus_tasks" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "manus_tasks_status_updated_at_idx" ON "manus_tasks" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "manus_tasks_expires_at_idx" ON "manus_tasks" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "manus_webhook_events_event_id_unique" ON "manus_webhook_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "manus_webhook_events_task_received_idx" ON "manus_webhook_events" USING btree ("task_id","received_at");--> statement-breakpoint
CREATE INDEX "manus_webhook_events_status_received_idx" ON "manus_webhook_events" USING btree ("process_status","received_at");--> statement-breakpoint
CREATE INDEX "manus_webhook_events_expires_at_idx" ON "manus_webhook_events" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "messages_session_created_at_idx" ON "messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_channel_message_id_unique" ON "messages" USING btree ("channel_message_id") WHERE "messages"."channel_message_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_manus_task_id_idx" ON "messages" USING btree ("manus_task_id");--> statement-breakpoint
CREATE INDEX "messages_expires_at_idx" ON "messages" USING btree ("expires_at");