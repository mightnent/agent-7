import { and, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { DEFAULT_WORKSPACE_ID, agentMemories } from "@/db/schema";

export type AgentMemoryCategory = "preference" | "fact" | "decision" | "task_outcome" | "correction";
export type AgentMemorySourceType = "extraction" | "explicit" | "inferred";

export interface AgentMemoryRecord {
  id: string;
  category: AgentMemoryCategory;
  content: string;
  sourceType: AgentMemorySourceType;
  sourceTaskId: string | null;
  sourceMessageId: string | null;
  supersededBy: string | null;
  confidence: number;
  createdAt: Date;
  lastAccessedAt: Date;
  expiresAt: Date | null;
}

export interface InsertAgentMemoryInput {
  category: AgentMemoryCategory;
  content: string;
  sourceType: AgentMemorySourceType;
  sourceTaskId?: string | null;
  sourceMessageId?: string | null;
  confidence: number;
  expiresAt?: Date | null;
  createdAt: Date;
  lastAccessedAt?: Date;
}

export interface AgentMemoryStore {
  insertMemory(input: InsertAgentMemoryInput): Promise<string>;
  supersedeMemories(memoryIds: string[], supersededBy: string, now: Date): Promise<void>;
  listActive(input?: {
    categories?: AgentMemoryCategory[];
    minConfidence?: number;
    limit?: number;
    query?: string;
  }): Promise<AgentMemoryRecord[]>;
  touchMemories(memoryIds: string[], now: Date): Promise<void>;
  listAdmin(input?: { page?: number; pageSize?: number }): Promise<{ total: number; items: AgentMemoryRecord[] }>;
  deleteMemory(memoryId: string): Promise<boolean>;
  clearAll(): Promise<number>;
  getStats(): Promise<{ total: number; lastExtractionAt: Date | null }>;
  cleanup(input: { now: Date; supersededRetentionDays: number }): Promise<{ expiredDeleted: number; supersededDeleted: number }>;
}

const ACTIVE_CATEGORY_ORDER_SQL = sql`CASE
  WHEN ${agentMemories.category} = 'preference' THEN 1
  WHEN ${agentMemories.category} = 'fact' THEN 2
  WHEN ${agentMemories.category} = 'correction' THEN 3
  WHEN ${agentMemories.category} = 'decision' THEN 4
  WHEN ${agentMemories.category} = 'task_outcome' THEN 5
  ELSE 99
END`;

const toAgentMemoryCategory = (value: string): AgentMemoryCategory => {
  if (value === "preference" || value === "fact" || value === "decision" || value === "task_outcome" || value === "correction") {
    return value;
  }

  return "fact";
};

const toAgentMemorySourceType = (value: string): AgentMemorySourceType => {
  if (value === "extraction" || value === "explicit" || value === "inferred") {
    return value;
  }

  return "extraction";
};

export class DrizzleAgentMemoryStore implements AgentMemoryStore {
  constructor(private readonly database: typeof db = db) {}

  async insertMemory(input: InsertAgentMemoryInput): Promise<string> {
    const normalizedContent = input.content.trim();
    if (!normalizedContent) {
      throw new Error("Memory content cannot be empty");
    }

    const rows = await this.database
      .insert(agentMemories)
      .values({
        workspaceId: DEFAULT_WORKSPACE_ID,
        category: input.category,
        content: normalizedContent,
        sourceType: input.sourceType,
        sourceTaskId: input.sourceTaskId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        supersededBy: null,
        confidence: Math.max(0, Math.min(1, input.confidence)),
        createdAt: input.createdAt,
        lastAccessedAt: input.lastAccessedAt ?? input.createdAt,
        expiresAt: input.expiresAt ?? null,
      })
      .returning({ id: agentMemories.id });

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to insert memory");
    }

    return row.id;
  }

  async supersedeMemories(memoryIds: string[], supersededBy: string, now: Date): Promise<void> {
    if (memoryIds.length === 0) {
      return;
    }

    await this.database
      .update(agentMemories)
      .set({
        supersededBy,
        lastAccessedAt: now,
      })
      .where(
        and(
          eq(agentMemories.workspaceId, DEFAULT_WORKSPACE_ID),
          inArray(agentMemories.id, memoryIds),
          isNull(agentMemories.supersededBy),
        ),
      );
  }

  async listActive(input: {
    categories?: AgentMemoryCategory[];
    minConfidence?: number;
    limit?: number;
    query?: string;
  } = {}): Promise<AgentMemoryRecord[]> {
    const whereParts = [
      eq(agentMemories.workspaceId, DEFAULT_WORKSPACE_ID),
      isNull(agentMemories.supersededBy),
      or(isNull(agentMemories.expiresAt), sql`${agentMemories.expiresAt} > now()`),
    ];

    if (input.categories && input.categories.length > 0) {
      whereParts.push(inArray(agentMemories.category, input.categories));
    }

    if (typeof input.minConfidence === "number") {
      whereParts.push(sql`${agentMemories.confidence} >= ${input.minConfidence}`);
    }

    const query = input.query?.trim();
    if (query) {
      whereParts.push(ilike(agentMemories.content, `%${query}%`));
    }

    const rows = await this.database
      .select({
        id: agentMemories.id,
        category: agentMemories.category,
        content: agentMemories.content,
        sourceType: agentMemories.sourceType,
        sourceTaskId: agentMemories.sourceTaskId,
        sourceMessageId: agentMemories.sourceMessageId,
        supersededBy: agentMemories.supersededBy,
        confidence: agentMemories.confidence,
        createdAt: agentMemories.createdAt,
        lastAccessedAt: agentMemories.lastAccessedAt,
        expiresAt: agentMemories.expiresAt,
      })
      .from(agentMemories)
      .where(and(...whereParts))
      .orderBy(ACTIVE_CATEGORY_ORDER_SQL, desc(agentMemories.lastAccessedAt))
      .limit(input.limit ?? 30);

    return rows.map((row) => ({
      ...row,
      category: toAgentMemoryCategory(row.category),
      sourceType: toAgentMemorySourceType(row.sourceType),
    }));
  }

  async touchMemories(memoryIds: string[], now: Date): Promise<void> {
    if (memoryIds.length === 0) {
      return;
    }

    await this.database
      .update(agentMemories)
      .set({
        lastAccessedAt: now,
      })
      .where(
        and(
          eq(agentMemories.workspaceId, DEFAULT_WORKSPACE_ID),
          inArray(agentMemories.id, memoryIds),
        ),
      );
  }

  async listAdmin(input: { page?: number; pageSize?: number } = {}): Promise<{ total: number; items: AgentMemoryRecord[] }> {
    const pageSize = Math.max(1, Math.min(100, input.pageSize ?? 20));
    const page = Math.max(1, input.page ?? 1);
    const offset = (page - 1) * pageSize;

    const [totalRow] = await this.database
      .select({ total: sql<number>`count(*)::int` })
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.workspaceId, DEFAULT_WORKSPACE_ID),
          isNull(agentMemories.supersededBy),
          or(isNull(agentMemories.expiresAt), sql`${agentMemories.expiresAt} > now()`),
        ),
      );

    const rows = await this.database
      .select({
        id: agentMemories.id,
        category: agentMemories.category,
        content: agentMemories.content,
        sourceType: agentMemories.sourceType,
        sourceTaskId: agentMemories.sourceTaskId,
        sourceMessageId: agentMemories.sourceMessageId,
        supersededBy: agentMemories.supersededBy,
        confidence: agentMemories.confidence,
        createdAt: agentMemories.createdAt,
        lastAccessedAt: agentMemories.lastAccessedAt,
        expiresAt: agentMemories.expiresAt,
      })
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.workspaceId, DEFAULT_WORKSPACE_ID),
          isNull(agentMemories.supersededBy),
          or(isNull(agentMemories.expiresAt), sql`${agentMemories.expiresAt} > now()`),
        ),
      )
      .orderBy(desc(agentMemories.lastAccessedAt))
      .limit(pageSize)
      .offset(offset);

    return {
      total: totalRow?.total ?? 0,
      items: rows.map((row) => ({
        ...row,
        category: toAgentMemoryCategory(row.category),
        sourceType: toAgentMemorySourceType(row.sourceType),
      })),
    };
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    const deleted = await this.database
      .delete(agentMemories)
      .where(and(eq(agentMemories.workspaceId, DEFAULT_WORKSPACE_ID), eq(agentMemories.id, memoryId)))
      .returning({ id: agentMemories.id });

    return Boolean(deleted[0]);
  }

  async clearAll(): Promise<number> {
    const deleted = await this.database
      .delete(agentMemories)
      .where(eq(agentMemories.workspaceId, DEFAULT_WORKSPACE_ID))
      .returning({ id: agentMemories.id });

    return deleted.length;
  }

  async getStats(): Promise<{ total: number; lastExtractionAt: Date | null }> {
    const [countRow] = await this.database
      .select({ total: sql<number>`count(*)::int` })
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.workspaceId, DEFAULT_WORKSPACE_ID),
          isNull(agentMemories.supersededBy),
          or(isNull(agentMemories.expiresAt), sql`${agentMemories.expiresAt} > now()`),
        ),
      );

    const [lastExtractionRow] = await this.database
      .select({ createdAt: agentMemories.createdAt })
      .from(agentMemories)
      .where(and(eq(agentMemories.workspaceId, DEFAULT_WORKSPACE_ID), eq(agentMemories.sourceType, "extraction")))
      .orderBy(desc(agentMemories.createdAt))
      .limit(1);

    return {
      total: countRow?.total ?? 0,
      lastExtractionAt: lastExtractionRow?.createdAt ?? null,
    };
  }

  async cleanup(input: { now: Date; supersededRetentionDays: number }): Promise<{ expiredDeleted: number; supersededDeleted: number }> {
    const supersededCutoff = new Date(input.now.getTime() - input.supersededRetentionDays * 24 * 60 * 60 * 1000);

    const expiredDeleted = await this.database
      .delete(agentMemories)
      .where(
        and(
          eq(agentMemories.workspaceId, DEFAULT_WORKSPACE_ID),
          sql`${agentMemories.expiresAt} is not null`,
          lt(agentMemories.expiresAt, input.now),
        ),
      )
      .returning({ id: agentMemories.id });

    const supersededDeleted = await this.database
      .delete(agentMemories)
      .where(
        and(
          eq(agentMemories.workspaceId, DEFAULT_WORKSPACE_ID),
          sql`${agentMemories.supersededBy} is not null`,
          lt(agentMemories.createdAt, supersededCutoff),
        ),
      )
      .returning({ id: agentMemories.id });

    return {
      expiredDeleted: expiredDeleted.length,
      supersededDeleted: supersededDeleted.length,
    };
  }
}
