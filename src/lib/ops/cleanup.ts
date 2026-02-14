import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";
import { ManusApiError, type ManusClient } from "@/lib/manus/client";

import type { CleanupStore, ExpirableTable } from "./cleanup.store";

const DEFAULT_BATCH_SIZE = 1_000;
const DEFAULT_MAX_BATCHES_PER_TABLE = 20;
const DEFAULT_STALE_CANDIDATE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_RECENT_WEBHOOK_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_HARD_FAIL_MAX_AGE_MS = 2 * 60 * 60 * 1000;
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
  staleCandidateTimeoutMs?: number;
  recentWebhookGraceMs?: number;
  hardFailMaxAgeMs?: number;
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
    manusClient: ManusClient;
  },
  options: RunCleanupOptions = {},
): Promise<CleanupSummary> => {
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatchesPerTable = options.maxBatchesPerTable ?? DEFAULT_MAX_BATCHES_PER_TABLE;
  const staleCandidateTimeoutMs = options.staleCandidateTimeoutMs ?? DEFAULT_STALE_CANDIDATE_TIMEOUT_MS;
  const recentWebhookGraceMs = options.recentWebhookGraceMs ?? DEFAULT_RECENT_WEBHOOK_GRACE_MS;
  const hardFailMaxAgeMs = options.hardFailMaxAgeMs ?? DEFAULT_HARD_FAIL_MAX_AGE_MS;

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

  const cleanupNow = now();
  const cutoff = new Date(cleanupNow.getTime() - staleCandidateTimeoutMs);
  const recentWebhookSince = new Date(cleanupNow.getTime() - recentWebhookGraceMs);
  const staleTasks = await deps.store.listStaleTasks(cutoff);

  let staleTasksMarkedFailed = 0;
  for (const staleTask of staleTasks) {
    const hasRecentWebhook = await deps.store.hasRecentWebhook(staleTask.taskId, recentWebhookSince);
    if (hasRecentWebhook) {
      continue;
    }

    const ageMs = cleanupNow.getTime() - staleTask.updatedAt.getTime();

    try {
      const task = await deps.manusClient.getTask(staleTask.taskId);
      if (task.status === "completed") {
        await deps.store.updateTaskFromProvider({
          taskId: staleTask.taskId,
          status: "completed",
          now: cleanupNow,
          message: null,
        });
        continue;
      }

      if (task.status === "failed") {
        await deps.store.updateTaskFromProvider({
          taskId: staleTask.taskId,
          status: "failed",
          now: cleanupNow,
          message: task.error ?? "Task failed on Manus.",
        });
        continue;
      }

      await deps.store.markTaskChecked(staleTask.taskId, cleanupNow);
      continue;
    } catch (error) {
      const missingTask =
        error instanceof ManusApiError &&
        error.status === 404 &&
        (error.body?.toLowerCase().includes("task not found") ?? false);

      const shouldHardFail = missingTask || ageMs >= hardFailMaxAgeMs;
      if (!shouldHardFail) {
        continue;
      }

      const failureReason = missingTask
        ? "Task no longer exists on Manus."
        : "Task timed out due to prolonged inactivity.";

      const failed = await deps.store.markTaskFailed(staleTask.taskId, cleanupNow, failureReason);
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
        createdAt: cleanupNow,
        expiresAt: new Date(cleanupNow.getTime() + MESSAGE_TTL_MS),
      });
    }
  }

  return {
    expiredDeletes,
    staleTasksMarkedFailed,
  };
};
