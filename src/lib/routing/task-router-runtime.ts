import { getEnv } from "@/lib/env";

import {
  JsonLlmTaskRouterClassifier,
  TaskRouter,
  type LlmCompletionClient,
  type TaskRouterClassifier,
  type TaskRouterStore,
} from "./task-router";

class FallbackNewTaskClassifier implements TaskRouterClassifier {
  async classify(): Promise<{ action: "new"; reason: string }> {
    return {
      action: "new",
      reason: "classifier_unconfigured_fallback_new",
    };
  }
}

interface OpenAiCompatibleChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export class OpenAiCompatibleLlmCompletionClient implements LlmCompletionClient {
  constructor(
    private readonly config: {
      apiKey: string;
      model: string;
      baseUrl: string;
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async complete(input: { system: string; prompt: string }): Promise<string> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);

    try {
      const response = await fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.prompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Router LLM request failed with status ${response.status}: ${body}`);
      }

      const payload = (await response.json()) as OpenAiCompatibleChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error("Router LLM response did not include message content");
      }

      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const createTaskRouterFromEnv = (options?: {
  store?: TaskRouterStore;
  fetchImpl?: typeof fetch;
}): TaskRouter => {
  const env = getEnv();

  let classifier: TaskRouterClassifier = new FallbackNewTaskClassifier();

  if (env.ROUTER_LLM_PROVIDER === "openai_compatible" && env.ROUTER_LLM_API_KEY) {
    classifier = new JsonLlmTaskRouterClassifier(
      new OpenAiCompatibleLlmCompletionClient({
        apiKey: env.ROUTER_LLM_API_KEY,
        model: env.ROUTER_LLM_MODEL,
        baseUrl: env.ROUTER_LLM_BASE_URL,
        fetchImpl: options?.fetchImpl,
      }),
    );
  }

  return new TaskRouter(classifier, options?.store);
};
