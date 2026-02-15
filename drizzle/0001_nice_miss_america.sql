CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plan_tier" text DEFAULT 'oss' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "workspaces" ("id", "slug", "name", "plan_tier", "status")
VALUES ('00000000-0000-0000-0000-000000000000', 'default', 'Default Workspace', 'oss', 'active')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
DROP INDEX "channel_sessions_channel_chat_user_unique";--> statement-breakpoint
DROP INDEX "manus_tasks_task_id_unique";--> statement-breakpoint
DROP INDEX "manus_webhook_events_event_id_unique";--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "manus_attachments" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "manus_tasks" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "manus_webhook_events" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD CONSTRAINT "channel_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manus_attachments" ADD CONSTRAINT "manus_attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manus_tasks" ADD CONSTRAINT "manus_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manus_webhook_events" ADD CONSTRAINT "manus_webhook_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_sessions_workspace_channel_chat_user_unique" ON "channel_sessions" USING btree ("workspace_id","channel","channel_chat_id","channel_user_id");--> statement-breakpoint
CREATE INDEX "manus_attachments_workspace_task_id_idx" ON "manus_attachments" USING btree ("workspace_id","task_id");--> statement-breakpoint
CREATE INDEX "manus_tasks_workspace_status_updated_at_idx" ON "manus_tasks" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "manus_webhook_events_workspace_task_received_idx" ON "manus_webhook_events" USING btree ("workspace_id","task_id","received_at");--> statement-breakpoint
CREATE INDEX "messages_workspace_session_created_at_idx" ON "messages" USING btree ("workspace_id","session_id","created_at");--> statement-breakpoint
ALTER TABLE "manus_tasks" ADD CONSTRAINT "manus_tasks_task_id_unique" UNIQUE("task_id");--> statement-breakpoint
ALTER TABLE "manus_webhook_events" ADD CONSTRAINT "manus_webhook_events_event_id_unique" UNIQUE("event_id");
