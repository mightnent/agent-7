import type { AgentMemoryStore, AgentMemoryRecord } from "./store";

const MEMORY_QUERY_CATEGORIES = ["preference", "fact", "decision", "task_outcome", "correction"] as const;

export const formatMemoriesForPrompt = (memories: AgentMemoryRecord[]): string => {
  if (memories.length === 0) {
    return "";
  }

  const lines = memories.map((memory) => `- ${memory.content}`);
  return ["Known context about this user:", ...lines].join("\n");
};

export const getMemoriesForTaskPrompt = async (
  store: AgentMemoryStore,
  now: Date,
): Promise<{ memories: AgentMemoryRecord[]; contextBlock: string }> => {
  const memories = await store.listActive({
    categories: [...MEMORY_QUERY_CATEGORIES],
    minConfidence: 0.5,
    limit: 30,
  });

  if (memories.length > 0) {
    await store.touchMemories(
      memories.map((memory) => memory.id),
      now,
    );
  }

  return {
    memories,
    contextBlock: formatMemoriesForPrompt(memories),
  };
};

export const getMemoriesForLocalResponse = async (
  store: AgentMemoryStore,
  query: string,
  now: Date,
): Promise<AgentMemoryRecord[]> => {
  const queried = await store.listActive({
    minConfidence: 0.5,
    limit: 12,
    query,
  });

  const memories = queried.length > 0 ? queried : await store.listActive({ minConfidence: 0.5, limit: 12 });

  if (memories.length > 0) {
    await store.touchMemories(
      memories.map((memory) => memory.id),
      now,
    );
  }

  return memories;
};
