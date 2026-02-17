import { DEFAULT_WORKSPACE_ID } from "@/db/schema";
import { settingsService } from "@/lib/config/settings-service";
import { getEnv } from "@/lib/env";
import { OpenAiCompatibleLlmCompletionClient } from "@/lib/routing/task-router-runtime";
import type { LlmCompletionClient, ResponseIntent } from "@/lib/routing/task-router";

import type { AgentMemoryRecord } from "@/lib/memory/store";

export interface LocalResponderResult {
  text: string;
  escalate: boolean;
}

export interface LocalResponder {
  respond(input: { message: string; intent: ResponseIntent; memories: AgentMemoryRecord[] }): Promise<LocalResponderResult>;
}

const LOCAL_RESPONSE_SYSTEM_PROMPT = [
  "You are a WhatsApp assistant giving direct responses without tools.",
  "Use only provided memory context and user message.",
  "If uncertain, set escalate=true.",
  "Respond with JSON only: {\"text\":\"...\",\"escalate\":boolean}.",
  "Keep responses concise and natural.",
].join(" ");

const parseResponse = (raw: string): LocalResponderResult | null => {
  const parseCandidate = (candidate: string): LocalResponderResult | null => {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
      const escalate = Boolean(parsed.escalate);
      if (!text) {
        return null;
      }

      return {
        text,
        escalate,
      };
    } catch {
      return null;
    }
  };

  const direct = parseCandidate(raw.trim());
  if (direct) {
    return direct;
  }

  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    return null;
  }

  return parseCandidate(objectMatch[0]);
};

const fallbackText = (intent: ResponseIntent, memories: AgentMemoryRecord[]): LocalResponderResult => {
  if (intent === "chitchat") {
    return { text: "Happy to help.", escalate: false };
  }

  if (intent === "memory_write") {
    return { text: "Noted. I saved that.", escalate: false };
  }

  if (intent === "unclear") {
    return { text: "I can help. Tell me exactly what you want me to do.", escalate: false };
  }

  if (memories.length > 0) {
    return { text: memories[0]?.content ?? "Here's what I currently know.", escalate: false };
  }

  return { text: "I might be missing context. I can run this as a full task if you want.", escalate: true };
};

class LlmLocalResponder implements LocalResponder {
  constructor(
    private readonly llmClient: LlmCompletionClient | null,
    private readonly personality: string | null,
  ) {}

  async respond(input: { message: string; intent: ResponseIntent; memories: AgentMemoryRecord[] }): Promise<LocalResponderResult> {
    if (!this.llmClient) {
      return fallbackText(input.intent, input.memories);
    }

    try {
      const raw = await this.llmClient.complete({
        system: LOCAL_RESPONSE_SYSTEM_PROMPT,
        prompt: JSON.stringify(
          {
            personality_markdown: this.personality ?? "",
            message: input.message,
            intent: input.intent,
            memories: input.memories.map((memory) => ({
              category: memory.category,
              content: memory.content,
              confidence: memory.confidence,
            })),
          },
          null,
          2,
        ),
      });

      return parseResponse(raw) ?? fallbackText(input.intent, input.memories);
    } catch {
      return fallbackText(input.intent, input.memories);
    }
  }
}

export const createLocalResponderFromEnv = async (
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<LocalResponder> => {
  const env = await getEnv(workspaceId);
  const personality = await settingsService.get(workspaceId, "agent", "personality");

  const llmClient =
    env.ROUTER_LLM_PROVIDER === "openai_compatible" && env.ROUTER_LLM_API_KEY
      ? new OpenAiCompatibleLlmCompletionClient({
          apiKey: env.ROUTER_LLM_API_KEY,
          model: env.ROUTER_LLM_MODEL,
          baseUrl: env.ROUTER_LLM_BASE_URL,
        })
      : null;

  return new LlmLocalResponder(llmClient, personality?.trim() || null);
};
