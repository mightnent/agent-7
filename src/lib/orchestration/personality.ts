import { DEFAULT_WORKSPACE_ID } from "@/db/schema";
import { settingsService } from "@/lib/config/settings-service";
import { getEnv } from "@/lib/env";
import { OpenAiCompatibleLlmCompletionClient } from "@/lib/routing/task-router-runtime";
import type { LlmCompletionClient } from "@/lib/routing/task-router";

const readTextFromJson = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parseCandidate = (candidate: string): string | null => {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const text = parsed.text;
      if (typeof text !== "string") {
        return null;
      }

      const normalized = text.trim();
      return normalized.length > 0 ? normalized : null;
    } catch {
      return null;
    }
  };

  return parseCandidate(trimmed) ?? (() => {
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }

    return parseCandidate(objectMatch[0]);
  })();
};

const loadPersonality = async (workspaceId: string): Promise<string | null> => {
  const value = await settingsService.get(workspaceId, "agent", "personality");
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export interface PersonalityMessageRenderer {
  buildTaskAcknowledgement(input: { taskTitle: string }): Promise<string | null>;
  frameTaskResult(input: { resultText: string }): Promise<string | null>;
}

class LlmPersonalityMessageRenderer implements PersonalityMessageRenderer {
  constructor(
    private readonly workspaceId: string,
    private readonly llmClient: LlmCompletionClient | null,
  ) {}

  async buildTaskAcknowledgement(input: { taskTitle: string }): Promise<string | null> {
    if (!this.llmClient) {
      return null;
    }

    const personality = await loadPersonality(this.workspaceId);
    if (!personality) {
      return null;
    }

    try {
      const raw = await this.llmClient.complete({
        system: [
          "You write acknowledgement messages for a WhatsApp assistant.",
          "Respond with JSON only: {\"text\":\"...\"}.",
          "Keep it concise (max 160 chars), natural, and do not use markdown.",
          "Do not add facts that were not provided.",
        ].join(" "),
        prompt: JSON.stringify(
          {
            personality_markdown: personality,
            task_title: input.taskTitle,
            instruction: "Write a short acknowledgement that confirms work has started.",
          },
          null,
          2,
        ),
      });

      return readTextFromJson(raw);
    } catch {
      return null;
    }
  }

  async frameTaskResult(input: { resultText: string }): Promise<string | null> {
    if (!this.llmClient) {
      return null;
    }

    const resultText = input.resultText.trim();
    if (!resultText) {
      return null;
    }

    const personality = await loadPersonality(this.workspaceId);
    if (!personality) {
      return null;
    }

    try {
      const raw = await this.llmClient.complete({
        system: [
          "You rewrite task result messages for a WhatsApp assistant.",
          "Respond with JSON only: {\"text\":\"...\"}.",
          "Preserve core meaning, links, and user-actionable details.",
          "Do not invent new facts or omit critical details.",
        ].join(" "),
        prompt: JSON.stringify(
          {
            personality_markdown: personality,
            original_result_text: resultText,
            instruction: "Rewrite this for delivery in WhatsApp using the personality.",
          },
          null,
          2,
        ),
      });

      return readTextFromJson(raw);
    } catch {
      return null;
    }
  }
}

const createLlmClientFromEnv = async (workspaceId: string): Promise<LlmCompletionClient | null> => {
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

export const createPersonalityMessageRendererFromEnv = async (
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<PersonalityMessageRenderer> => {
  const llmClient = await createLlmClientFromEnv(workspaceId);
  return new LlmPersonalityMessageRenderer(workspaceId, llmClient);
};
