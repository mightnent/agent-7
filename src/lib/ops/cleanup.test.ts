import { describe, expect, it, vi } from "vitest";

import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";
import type { ManusClient } from "@/lib/manus/client";
import { ManusApiError } from "@/lib/manus/client";

import { runCleanup } from "./cleanup";
import type { CleanupStore } from "./cleanup.store";

const createStoreMock = (): CleanupStore => ({
  deleteExpiredRows: vi.fn(),
  listStaleTasks: vi.fn(),
  hasRecentWebhook: vi.fn(),
  markTaskChecked: vi.fn(),
  updateTaskFromProvider: vi.fn(),
  markTaskFailed: vi.fn(),
  createStaleTaskOutboundMessage: vi.fn(),
});

const createAdapterMock = (): WhatsAppAdapter => ({
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  setTyping: vi.fn(),
});

const createManusClientMock = (): ManusClient =>
  ({
    getTask: vi.fn(),
  }) as unknown as ManusClient;

describe("runCleanup", () => {
  it("deletes expired rows in batches until exhausted", async () => {
    const store = createStoreMock();
    const adapter = createAdapterMock();
    const manusClient = createManusClientMock();

    vi.mocked(store.deleteExpiredRows)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(0);
    vi.mocked(store.listStaleTasks).mockResolvedValue([]);

    const result = await runCleanup(
      {
        store,
        whatsappAdapter: adapter,
        manusClient,
      },
      {
        batchSize: 2,
        maxBatchesPerTable: 2,
      },
    );

    expect(result.expiredDeletes.messages).toBe(2);
    expect(result.staleTasksMarkedFailed).toBe(0);
  });

  it("marks stale tasks failed and notifies users", async () => {
    const store = createStoreMock();
    const adapter = createAdapterMock();
    const manusClient = createManusClientMock();
    const now = new Date("2026-02-14T00:00:00.000Z");

    vi.mocked(store.deleteExpiredRows).mockResolvedValue(0);
    vi.mocked(store.listStaleTasks).mockResolvedValue([
      {
        taskId: "task-1",
        sessionId: "session-1",
        chatId: "1555@s.whatsapp.net",
        updatedAt: new Date(now.getTime() - 20 * 60_000),
      },
    ]);
    vi.mocked(store.hasRecentWebhook).mockResolvedValue(false);
    vi.mocked(manusClient.getTask).mockRejectedValue(
      new ManusApiError("Manus request failed with status 404", 404, '{"message":"task not found"}'),
    );
    vi.mocked(store.markTaskFailed).mockResolvedValue(true);

    const result = await runCleanup(
      {
        store,
        whatsappAdapter: adapter,
        manusClient,
      },
      {
        staleCandidateTimeoutMs: 1_000,
        now: () => now,
      },
    );

    expect(result.staleTasksMarkedFailed).toBe(1);
    expect(vi.mocked(adapter.sendTextMessage)).toHaveBeenCalledWith(
      "1555@s.whatsapp.net",
      expect.stringContaining("timed out"),
    );
    expect(vi.mocked(store.createStaleTaskOutboundMessage)).toHaveBeenCalledTimes(1);
  });

  it("keeps provider-running tasks alive without failing them", async () => {
    const store = createStoreMock();
    const adapter = createAdapterMock();
    const manusClient = createManusClientMock();
    const now = new Date("2026-02-14T00:00:00.000Z");

    vi.mocked(store.deleteExpiredRows).mockResolvedValue(0);
    vi.mocked(store.listStaleTasks).mockResolvedValue([
      {
        taskId: "task-2",
        sessionId: "session-2",
        chatId: "1666@s.whatsapp.net",
        updatedAt: new Date(now.getTime() - 20 * 60_000),
      },
    ]);
    vi.mocked(store.hasRecentWebhook).mockResolvedValue(false);
    vi.mocked(manusClient.getTask).mockResolvedValue({
      id: "task-2",
      object: "task",
      created_at: 0,
      updated_at: 0,
      status: "running",
    });
    vi.mocked(store.markTaskChecked).mockResolvedValue(true);

    const result = await runCleanup(
      {
        store,
        whatsappAdapter: adapter,
        manusClient,
      },
      {
        staleCandidateTimeoutMs: 1_000,
        now: () => now,
      },
    );

    expect(result.staleTasksMarkedFailed).toBe(0);
    expect(vi.mocked(store.markTaskChecked)).toHaveBeenCalledWith("task-2", now);
    expect(vi.mocked(store.markTaskFailed)).not.toHaveBeenCalled();
    expect(vi.mocked(adapter.sendTextMessage)).not.toHaveBeenCalled();
  });
});
