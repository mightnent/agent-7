ALTER TYPE "public"."route_action" ADD VALUE IF NOT EXISTS 'respond';

CREATE TABLE IF NOT EXISTS "agent_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
  "category" text NOT NULL,
  "content" text NOT NULL,
  "source_type" text NOT NULL,
  "source_task_id" text,
  "source_message_id" uuid,
  "superseded_by" uuid,
  "confidence" real DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  CONSTRAINT "agent_memories_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE restrict,
  CONSTRAINT "agent_memories_source_message_fk"
    FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id")
    ON DELETE set null,
  CONSTRAINT "agent_memories_superseded_fk"
    FOREIGN KEY ("superseded_by") REFERENCES "public"."agent_memories"("id")
    ON DELETE set null,
  CONSTRAINT "agent_memories_valid_category"
    CHECK ("category" IN ('preference', 'fact', 'decision', 'task_outcome', 'correction')),
  CONSTRAINT "agent_memories_valid_source_type"
    CHECK ("source_type" IN ('extraction', 'explicit', 'inferred'))
);

CREATE INDEX IF NOT EXISTS "agent_memories_workspace_category_idx"
  ON "agent_memories" ("workspace_id", "category");
CREATE INDEX IF NOT EXISTS "agent_memories_workspace_created_at_idx"
  ON "agent_memories" ("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "agent_memories_workspace_accessed_at_idx"
  ON "agent_memories" ("workspace_id", "last_accessed_at" DESC);
CREATE INDEX IF NOT EXISTS "agent_memories_superseded_idx"
  ON "agent_memories" ("superseded_by")
  WHERE "superseded_by" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "agent_memories_expires_at_idx"
  ON "agent_memories" ("expires_at")
  WHERE "expires_at" IS NOT NULL;
