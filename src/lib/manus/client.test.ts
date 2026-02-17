import { describe, expect, it, vi } from "vitest";

import { ManusApiError, ManusClient, toManusBase64Attachments } from "./client";

describe("toManusBase64Attachments", () => {
  it("converts buffers to data-url base64 attachments", () => {
    const attachments = toManusBase64Attachments([
      {
        fileName: "image.png",
        mimetype: "image/png",
        buffer: Buffer.from("abc"),
      },
    ]);

    expect(attachments).toEqual([
      {
        filename: "image.png",
        fileData: "data:image/png;base64,YWJj",
      },
    ]);
  });
});

describe("ManusClient", () => {
  const config = {
    apiKey: "test-api-key",
    baseUrl: "https://api.manus.ai",
    maxAttempts: 3,
    baseRetryDelayMs: 0,
  };

  it("creates task with default adaptive payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          task_id: "task-1",
          task_title: "Task 1",
          task_url: "https://manus.im/app/task-1",
        }),
        { status: 200 },
      ),
    );

    const client = new ManusClient({ ...config, fetchImpl });

    const response = await client.createTask("hello");

    expect(response.task_id).toBe("task-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.manus.ai/v1/tasks");

    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({
      prompt: "hello",
      taskMode: "adaptive",
      agentProfile: "manus-1.6",
      interactiveMode: true,
      hideInTaskList: true,
    });

    const headers = init.headers as Headers;
    expect(headers.get("API_KEY")).toBe("test-api-key");
    expect(headers.get("x-request-id")).toBeTruthy();
  });

  it("continues task by sending taskId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          task_id: "task-1",
          task_title: "Task 1",
          task_url: "https://manus.im/app/task-1",
        }),
        { status: 200 },
      ),
    );

    const client = new ManusClient({ ...config, fetchImpl });

    await client.continueTask("task-1", "follow up");

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));

    expect(payload.taskId).toBe("task-1");
    expect(payload.prompt).toBe("follow up");
  });

  it("retries on retryable status and then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("service unavailable", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: "task-2",
            task_title: "Task 2",
            task_url: "https://manus.im/app/task-2",
          }),
          { status: 200 },
        ),
      );

    const client = new ManusClient({ ...config, fetchImpl });
    const response = await client.createTask("retry test");

    expect(response.task_id).toBe("task-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws ManusApiError after max attempts on persistent server failure", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response("still failing", { status: 503 }));

    const client = new ManusClient({ ...config, fetchImpl });

    await expect(client.createTask("will fail")).rejects.toBeInstanceOf(ManusApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fetches task details", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "task-1",
          object: "task",
          created_at: 1,
          updated_at: 2,
          status: "running",
        }),
        { status: 200 },
      ),
    );

    const client = new ManusClient({ ...config, fetchImpl });

    const task = await client.getTask("task-1", { convert: true });

    expect(task.id).toBe("task-1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.manus.ai/v1/tasks/task-1?convert=true",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("creates project and returns project_id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          project_id: "proj-1",
          name: "Agent-7",
        }),
        { status: 200 },
      ),
    );

    const client = new ManusClient({ ...config, fetchImpl });
    const response = await client.createProject({
      name: "Agent-7",
      instruction: "## Context",
    });

    expect(response.project_id).toBe("proj-1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.manus.ai/v1/projects",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("updates project instructions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new ManusClient({ ...config, fetchImpl });

    await client.updateProject("proj-1", {
      instruction: "New instructions",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.manus.ai/v1/projects/proj-1",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
  });

  it("registers webhook and returns webhook id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            webhook_id: "wh-3",
            webhook: {
              url: "https://new.example.com/api/manus/webhook?secret=abc",
            },
          }),
          { status: 200 },
        ),
      );

    const client = new ManusClient({ ...config, fetchImpl });
    const webhookId = await client.registerWebhook("https://new.example.com/api/manus/webhook?secret=abc");

    expect(webhookId).toBe("wh-3");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.manus.ai/v1/webhooks",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
