import { describe, expect, it, vi } from "vitest";

import { resetEnvCacheForTests } from "@/lib/env";

import { createTaskRouterFromEnv, OpenAiCompatibleLlmCompletionClient } from "./task-router-runtime";

describe("OpenAiCompatibleLlmCompletionClient", () => {
  it("returns response content from chat completions payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"action":"new","reason":"different intent"}',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const client = new OpenAiCompatibleLlmCompletionClient({
      apiKey: "router-key",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com",
      fetchImpl,
      timeoutMs: 500,
    });

    const output = await client.complete({
      system: "sys",
      prompt: "prompt",
    });

    expect(output).toBe('{"action":"new","reason":"different intent"}');
  });
});

describe("createTaskRouterFromEnv", () => {
  it("falls back to deterministic new-task classifier when provider disabled", async () => {
    resetEnvCacheForTests();
    process.env.ROUTER_LLM_PROVIDER = "none";
    process.env.ROUTER_LLM_API_KEY = "";

    const router = await createTaskRouterFromEnv();
    const result = await router.route({
      message: "hello",
      activeTasks: [
        {
          taskId: "task-1",
          taskTitle: "Task 1",
          originalPrompt: "Do thing",
          status: "running",
          lastMessage: null,
        },
      ],
    });

    expect(result).toEqual({
      action: "new",
      reason: "classifier_unconfigured_fallback_new",
    });
    resetEnvCacheForTests();
  });
});
