import type { LlmCompletionClient } from "@/lib/routing/task-router";

import type { AgentMemoryCategory, AgentMemoryRecord, AgentMemorySourceType, AgentMemoryStore } from "./store";

export interface MemoryExtractionInput {
  sourceTaskId: string;
  userRequest: string;
  taskTitle: string | null;
  taskResult: string;
  sourceMessageId?: string | null;
  now: Date;
}

interface ExtractedMemory {
  category: AgentMemoryCategory;
  content: string;
  confidence: number;
}

const EXTRACTION_SYSTEM_PROMPT = [
  "You extract memorable facts from completed task interactions.",
  "Return JSON only, with schema: {\"memories\":[{\"category\":\"preference|fact|decision|task_outcome|correction\",\"content\":\"...\",\"confidence\":0.0-1.0}]}",
  "Only include genuinely useful information that improves future responses.",
  "If nothing is worth remembering, return {\"memories\":[]}.",
  "Never fabricate facts.",
].join(" ");

const TTL_BY_CATEGORY_DAYS: Partial<Record<AgentMemoryCategory, number>> = {
  decision: 90,
  task_outcome: 60,
};

const normalizeForCompare = (value: string): string => value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const coerceCategory = (value: unknown): AgentMemoryCategory | null => {
  if (value === "preference" || value === "fact" || value === "decision" || value === "task_outcome" || value === "correction") {
    return value;
  }

  return null;
};

const parseExtractedMemories = (raw: string): ExtractedMemory[] => {
  const parseCandidate = (candidate: string): ExtractedMemory[] | null => {
    try {
      const parsed = JSON.parse(candidate) as { memories?: unknown } | unknown[];
      const list = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { memories?: unknown }).memories)
          ? (parsed as { memories: unknown[] }).memories
          : [];

      return list
        .map((item) => {
          if (typeof item !== "object" || item === null) {
            return null;
          }

          const row = item as Record<string, unknown>;
          const category = coerceCategory(row.category);
          const content = typeof row.content === "string" ? row.content.trim() : "";
          const confidenceValue = typeof row.confidence === "number" ? row.confidence : 0.7;
          const confidence = Math.max(0, Math.min(1, confidenceValue));

          if (!category || !content) {
            return null;
          }

          return {
            category,
            content,
            confidence,
          } satisfies ExtractedMemory;
        })
        .filter((item): item is ExtractedMemory => item !== null);
    } catch {
      return null;
    }
  };

  const trimmed = raw.trim();
  const direct = parseCandidate(trimmed);
  if (direct) {
    return direct;
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const wrapped = parseCandidate(objectMatch[0]);
    if (wrapped) {
      return wrapped;
    }
  }

  return [];
};

const computeExpiry = (category: AgentMemoryCategory, now: Date): Date | null => {
  const days = TTL_BY_CATEGORY_DAYS[category];
  if (!days) {
    return null;
  }

  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
};

const isDuplicateOrSuperseded = (
  candidate: ExtractedMemory,
  existing: AgentMemoryRecord,
): { duplicate: boolean; supersede: boolean } => {
  const candidateNorm = normalizeForCompare(candidate.content);
  const existingNorm = normalizeForCompare(existing.content);

  if (!candidateNorm || !existingNorm) {
    return { duplicate: false, supersede: false };
  }

  if (candidateNorm === existingNorm || candidateNorm.includes(existingNorm) || existingNorm.includes(candidateNorm)) {
    return { duplicate: true, supersede: false };
  }

  const topicConflict =
    (candidate.category === "fact" && existing.category === "fact" &&
      ((candidateNorm.includes("timezone") && existingNorm.includes("timezone")) ||
        (candidateNorm.includes("company") && existingNorm.includes("company")))) ||
    (candidate.category === "preference" && existing.category === "preference" && candidateNorm.split(" ")[0] === existingNorm.split(" ")[0]);

  return { duplicate: false, supersede: topicConflict };
};

export const extractAndStoreTaskMemories = async (
  deps: {
    llmClient: LlmCompletionClient | null;
    memoryStore: AgentMemoryStore;
  },
  input: MemoryExtractionInput,
): Promise<{ inserted: number; superseded: number }> => {
  if (!deps.llmClient) {
    return { inserted: 0, superseded: 0 };
  }

  const existing = await deps.memoryStore.listActive({ limit: 120 });

  const raw = await deps.llmClient.complete({
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt: JSON.stringify(
      {
        user_request: input.userRequest,
        task_title: input.taskTitle,
        task_result: input.taskResult,
        existing_memories: existing.slice(0, 25).map((memory) => memory.content),
      },
      null,
      2,
    ),
  });

  const extracted = parseExtractedMemories(raw);
  if (extracted.length === 0) {
    return { inserted: 0, superseded: 0 };
  }

  let inserted = 0;
  let superseded = 0;

  for (const memory of extracted) {
    let duplicate = false;
    const supersedeIds: string[] = [];

    for (const existingMemory of existing) {
      const result = isDuplicateOrSuperseded(memory, existingMemory);
      if (result.duplicate) {
        duplicate = true;
        break;
      }

      if (result.supersede) {
        supersedeIds.push(existingMemory.id);
      }
    }

    if (duplicate) {
      continue;
    }

    const memoryId = await deps.memoryStore.insertMemory({
      category: memory.category,
      content: memory.content,
      sourceType: "extraction" satisfies AgentMemorySourceType,
      sourceTaskId: input.sourceTaskId,
      sourceMessageId: input.sourceMessageId ?? null,
      confidence: memory.confidence,
      createdAt: input.now,
      lastAccessedAt: input.now,
      expiresAt: computeExpiry(memory.category, input.now),
    });
    inserted += 1;

    if (supersedeIds.length > 0) {
      await deps.memoryStore.supersedeMemories(supersedeIds, memoryId, input.now);
      superseded += supersedeIds.length;
    }
  }

  return { inserted, superseded };
};
