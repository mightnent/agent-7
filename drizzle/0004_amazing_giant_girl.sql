ALTER TABLE "whatsapp_auth_keys" RENAME COLUMN "value" TO "encrypted_value";--> statement-breakpoint
ALTER TABLE "whatsapp_auth_keys" ALTER COLUMN "encrypted_value" TYPE text USING "encrypted_value"::text;--> statement-breakpoint
ALTER TABLE "whatsapp_auth_keys" ADD COLUMN "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_auth_keys" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
