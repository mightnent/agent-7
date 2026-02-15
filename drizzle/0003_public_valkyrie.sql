CREATE TABLE "whatsapp_auth_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
	"session_name" text DEFAULT 'default' NOT NULL,
	"key_type" text NOT NULL,
	"key_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
	"channel" "channel" DEFAULT 'whatsapp' NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"phone_number" text,
	"display_name" text,
	"connected_at" timestamp with time zone,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_auth_keys" ADD CONSTRAINT "whatsapp_auth_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_channels" ADD CONSTRAINT "workspace_channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_auth_keys_workspace_session_key_type_key_id_unique" ON "whatsapp_auth_keys" USING btree ("workspace_id","session_name","key_type","key_id");--> statement-breakpoint
CREATE INDEX "whatsapp_auth_keys_workspace_session_idx" ON "whatsapp_auth_keys" USING btree ("workspace_id","session_name");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_channels_workspace_channel_unique" ON "workspace_channels" USING btree ("workspace_id","channel");