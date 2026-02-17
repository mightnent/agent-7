import { DEFAULT_WORKSPACE_ID } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { OpenAiCompatibleLlmCompletionClient } from "@/lib/routing/task-router-runtime";
import type { LlmCompletionClient } from "@/lib/routing/task-router";

export const createMemoryLlmClientFromEnv = async (
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<LlmCompletionClient | null> => {
  const env = await getEnv(workspaceId);
  if (env.ROUTER_LLM_PROVIDER !== "openai_compatible" || !env.ROUTER_LLM_API_KEY) {
    return null;
  }

  return new OpenAiCompatibleLlmCompletionClient({
    apiKey: env.ROUTER_LLM_API_KEY,
    model: env.ROUTER_LLM_MODEL,
    baseUrl: env.ROUTER_LLM_BASE_URL,
  });
};
