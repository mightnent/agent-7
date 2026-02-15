CREATE TABLE "workspace_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"encrypted_value" text,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_settings_workspace_category_key_unique" ON "workspace_settings" USING btree ("workspace_id","category","key");--> statement-breakpoint
CREATE INDEX "workspace_settings_workspace_category_idx" ON "workspace_settings" USING btree ("workspace_id","category");