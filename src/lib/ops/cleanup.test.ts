import { describe, expect, it, vi } from "vitest";

import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";

import { runCleanup } from "./cleanup";
import type { CleanupStore } from "./cleanup.store";

const createStoreMock = (): CleanupStore => ({
  deleteExpiredRows: vi.fn(),
  listStaleTasks: vi.fn(),
  markTaskFailed: vi.fn(),
  createStaleTaskOutboundMessage: vi.fn(),
});

const createAdapterMock = (): WhatsAppAdapter => ({
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  setTyping: vi.fn(),
});

describe("runCleanup", () => {
  it("deletes expired rows in batches until exhausted", async () => {
    const store = createStoreMock();
    const adapter = createAdapterMock();

    vi.mocked(store.deleteExpiredRows)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(0);
    vi.mocked(store.listStaleTasks).mockResolvedValue([]);

    const result = await runCleanup(
      {
        store,
        whatsappAdapter: adapter,
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

    vi.mocked(store.deleteExpiredRows).mockResolvedValue(0);
    vi.mocked(store.listStaleTasks).mockResolvedValue([
      {
        taskId: "task-1",
        sessionId: "session-1",
        chatId: "1555@s.whatsapp.net",
      },
    ]);
    vi.mocked(store.markTaskFailed).mockResolvedValue(true);

    const result = await runCleanup(
      {
        store,
        whatsappAdapter: adapter,
      },
      {
        staleTimeoutMs: 1_000,
      },
    );

    expect(result.staleTasksMarkedFailed).toBe(1);
    expect(vi.mocked(adapter.sendTextMessage)).toHaveBeenCalledWith(
      "1555@s.whatsapp.net",
      expect.stringContaining("timed out"),
    );
    expect(vi.mocked(store.createStaleTaskOutboundMessage)).toHaveBeenCalledTimes(1);
  });
});
