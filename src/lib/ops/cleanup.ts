import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";

import type { CleanupStore, ExpirableTable } from "./cleanup.store";

const DEFAULT_BATCH_SIZE = 1_000;
const DEFAULT_MAX_BATCHES_PER_TABLE = 20;
const DEFAULT_STALE_TIMEOUT_MS = 10 * 60 * 1000;
const MESSAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const cleanupTableOrder: ExpirableTable[] = [
  "messages",
  "manus_attachments",
  "manus_webhook_events",
  "manus_tasks",
  "channel_sessions",
];

export interface RunCleanupOptions {
  now?: () => Date;
  batchSize?: number;
  maxBatchesPerTable?: number;
  staleTimeoutMs?: number;
}

export interface CleanupSummary {
  expiredDeletes: Record<ExpirableTable, number>;
  staleTasksMarkedFailed: number;
}

const staleTaskNotice = (taskId: string): string => {
  return `Task ${taskId} timed out due to inactivity. Please send another message if you want me to retry.`;
};

export const runCleanup = async (
  deps: {
    store: CleanupStore;
    whatsappAdapter: WhatsAppAdapter;
  },
  options: RunCleanupOptions = {},
): Promise<CleanupSummary> => {
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatchesPerTable = options.maxBatchesPerTable ?? DEFAULT_MAX_BATCHES_PER_TABLE;
  const staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;

  const expiredDeletes: Record<ExpirableTable, number> = {
    channel_sessions: 0,
    messages: 0,
    manus_tasks: 0,
    manus_webhook_events: 0,
    manus_attachments: 0,
  };

  for (const table of cleanupTableOrder) {
    for (let batch = 0; batch < maxBatchesPerTable; batch += 1) {
      const deleted = await deps.store.deleteExpiredRows(table, now(), batchSize);
      expiredDeletes[table] += deleted;

      if (deleted < batchSize) {
        break;
      }
    }
  }

  const cutoff = new Date(now().getTime() - staleTimeoutMs);
  const staleTasks = await deps.store.listStaleTasks(cutoff);

  let staleTasksMarkedFailed = 0;
  for (const staleTask of staleTasks) {
    const failed = await deps.store.markTaskFailed(staleTask.taskId, now(), "Task timed out due to inactivity");
    if (!failed) {
      continue;
    }

    staleTasksMarkedFailed += 1;

    const notice = staleTaskNotice(staleTask.taskId);
    await deps.whatsappAdapter.sendTextMessage(staleTask.chatId, notice);
    await deps.store.createStaleTaskOutboundMessage({
      sessionId: staleTask.sessionId,
      taskId: staleTask.taskId,
      contentText: notice,
      createdAt: now(),
      expiresAt: new Date(now().getTime() + MESSAGE_TTL_MS),
    });
  }

  return {
    expiredDeletes,
    staleTasksMarkedFailed,
  };
};
