import type { AgentMemoryStore } from "./store";

export const runMemoryMaintenance = async (
  store: AgentMemoryStore,
  now: Date,
): Promise<{ expiredDeleted: number; supersededDeleted: number }> => {
  return store.cleanup({
    now,
    supersededRetentionDays: 30,
  });
};
