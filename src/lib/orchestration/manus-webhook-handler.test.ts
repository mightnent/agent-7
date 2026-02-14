import { describe, expect, it, vi } from "vitest";

import type { EventProcessor } from "./event-processor";
import { handleManusWebhook } from "./manus-webhook-handler";
import type { WebhookEventLifecycleStore } from "./event-processor.store";

const createMocks = (): {
  lifecycleStore: WebhookEventLifecycleStore;
  eventProcessor: EventProcessor;
} => {
  const lifecycleStore: WebhookEventLifecycleStore = {
    insertWebhookEventIfNew: vi.fn(),
    markWebhookEventProcessed: vi.fn(),
    markWebhookEventFailed: vi.fn(),
  };

  const eventProcessor: EventProcessor = {
    process: vi.fn(),
  };

  return { lifecycleStore, eventProcessor };
};

describe("handleManusWebhook", () => {
  it("rejects invalid secrets", async () => {
    const { lifecycleStore, eventProcessor } = createMocks();

    const result = await handleManusWebhook({
      providedSecret: "wrong",
      expectedSecret: "right",
      payload: {},
      lifecycleStore,
      eventProcessor,
    });

    expect(result.status).toBe(401);
    expect(result.body.status).toBe("unauthorized");
    expect(vi.mocked(lifecycleStore.insertWebhookEventIfNew)).not.toHaveBeenCalled();
  });

  it("returns duplicate when event already processed", async () => {
    const { lifecycleStore, eventProcessor } = createMocks();
    vi.mocked(lifecycleStore.insertWebhookEventIfNew).mockResolvedValue(false);

    const result = await handleManusWebhook({
      providedSecret: "right",
      expectedSecret: "right",
      payload: {
        event_id: "evt-1",
        event_type: "task_created",
        task_detail: {
          task_id: "task-1",
        },
      },
      lifecycleStore,
      eventProcessor,
    });

    expect(result.status).toBe(200);
    expect(result.body.status).toBe("duplicate");
    expect(vi.mocked(eventProcessor.process)).not.toHaveBeenCalled();
  });

  it("marks event as processed on success", async () => {
    const { lifecycleStore, eventProcessor } = createMocks();
    vi.mocked(lifecycleStore.insertWebhookEventIfNew).mockResolvedValue(true);
    vi.mocked(eventProcessor.process).mockResolvedValue(undefined);

    const result = await handleManusWebhook({
      providedSecret: "right",
      expectedSecret: "right",
      payload: {
        event_id: "evt-2",
        event_type: "task_progress",
        progress_detail: {
          task_id: "task-1",
          progress_type: "plan_update",
          message: "working",
        },
      },
      lifecycleStore,
      eventProcessor,
    });

    expect(result.status).toBe(200);
    expect(result.body.status).toBe("processed");
    expect(vi.mocked(lifecycleStore.markWebhookEventProcessed)).toHaveBeenCalledTimes(1);
  });

  it("marks event as failed when processor throws", async () => {
    const { lifecycleStore, eventProcessor } = createMocks();
    vi.mocked(lifecycleStore.insertWebhookEventIfNew).mockResolvedValue(true);
    vi.mocked(eventProcessor.process).mockRejectedValue(new Error("boom"));

    const result = await handleManusWebhook({
      providedSecret: "right",
      expectedSecret: "right",
      payload: {
        event_id: "evt-3",
        event_type: "task_progress",
        progress_detail: {
          task_id: "task-1",
          progress_type: "plan_update",
          message: "working",
        },
      },
      lifecycleStore,
      eventProcessor,
    });

    expect(result.status).toBe(500);
    expect(result.body.status).toBe("failed");
    expect(vi.mocked(lifecycleStore.markWebhookEventFailed)).toHaveBeenCalledTimes(1);
  });
});
