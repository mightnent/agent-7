/**
 * Integration tests against real Neon database.
 *
 * These tests exercise the full orchestration pipeline with real Drizzle stores,
 * mocking only external APIs (Manus, WhatsApp adapter).
 *
 * Run with: npx vitest run src/integration --env-file .env
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db/client";
import {
  channelSessions,
  manusAttachments,
  manusTasks,
  manusWebhookEvents,
  messages,
} from "@/db/schema";
import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";
import { DrizzleWhatsAppInboundStore } from "@/lib/channel/whatsapp-inbound.store";
import { ManusClient } from "@/lib/manus/client";
import { createEventProcessor } from "@/lib/orchestration/event-processor";
import { DrizzleEventProcessorStore } from "@/lib/orchestration/event-processor.store";
import { dispatchInboundMessage } from "@/lib/orchestration/inbound-dispatch";
import { handleManusWebhook } from "@/lib/orchestration/manus-webhook-handler";
import { DrizzleTaskCreationStore } from "@/lib/orchestration/task-creation.store";
import { TaskRouter } from "@/lib/routing/task-router";
import { DrizzleTaskRouterStore } from "@/lib/routing/task-router.store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_JID = `${randomUUID().slice(0, 8)}@s.whatsapp.net`;
const now = () => new Date();

const createMockAdapter = (): WhatsAppAdapter & {
  sentTexts: Array<{ jid: string; text: string }>;
  sentMedia: Array<{ jid: string; fileName: string }>;
} => {
  const sentTexts: Array<{ jid: string; text: string }> = [];
  const sentMedia: Array<{ jid: string; fileName: string }> = [];

  return {
    sentTexts,
    sentMedia,
    async sendTextMessage(jid: string, text: string) {
      sentTexts.push({ jid, text });
    },
    async sendMediaMessage(jid: string, media: { fileName: string }) {
      sentMedia.push({ jid, fileName: media.fileName });
    },
    async setTyping() {},
  };
};

const createMockManusClient = (): ManusClient & {
  calls: Array<{ prompt: string; taskId?: string }>;
} => {
  let taskCounter = 0;
  const calls: Array<{ prompt: string; taskId?: string }> = [];

  const client = {
    calls,
    async createTask(prompt: string, options: { taskId?: string } = {}) {
      taskCounter += 1;
      const taskId = options.taskId ?? `manus-task-${taskCounter}`;
      calls.push({ prompt, taskId: options.taskId });
      return {
        task_id: taskId,
        task_title: `Task: ${prompt.slice(0, 30)}`,
        task_url: `https://manus.im/app/${taskId}`,
      };
    },
    async continueTask(taskId: string, prompt: string, options = {}) {
      calls.push({ prompt, taskId });
      return client.createTask(prompt, { ...options, taskId });
    },
    async getTask() {
      return {} as never;
    },
  } as unknown as ManusClient & {
    calls: Array<{ prompt: string; taskId?: string }>;
  };

  return client;
};

// ---------------------------------------------------------------------------
// Cleanup between tests - delete rows for our test JID
// ---------------------------------------------------------------------------

const cleanupTestData = async () => {
  const sessionRows = await db
    .select({ id: channelSessions.id })
    .from(channelSessions)
    .where(eq(channelSessions.channelChatId, TEST_JID));

  const sessionIds = sessionRows.map((r) => r.id);
  if (sessionIds.length === 0) return;

  for (const sid of sessionIds) {
    const taskRows = await db
      .select({ taskId: manusTasks.taskId })
      .from(manusTasks)
      .where(eq(manusTasks.sessionId, sid));

    for (const t of taskRows) {
      await db
        .delete(manusAttachments)
        .where(eq(manusAttachments.taskId, t.taskId));
      await db
        .delete(manusWebhookEvents)
        .where(eq(manusWebhookEvents.taskId, t.taskId));
    }

    await db.delete(manusTasks).where(eq(manusTasks.sessionId, sid));
    await db.delete(messages).where(eq(messages.sessionId, sid));
    await db
      .delete(channelSessions)
      .where(eq(channelSessions.id, sid));
  }
};

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
});

// ---------------------------------------------------------------------------
// Real store instances
// ---------------------------------------------------------------------------

const inboundStore = new DrizzleWhatsAppInboundStore(db);
const taskCreationStore = new DrizzleTaskCreationStore(db);
const eventProcessorStore = new DrizzleEventProcessorStore(db);
const taskRouterStore = new DrizzleTaskRouterStore(db);

// ---------------------------------------------------------------------------
// Test: Full finish flow
// ---------------------------------------------------------------------------

describe("Integration: Full finish flow", () => {
  it("inbound → create task → webhook task_stopped finish → outbound reply", async () => {
    const adapter = createMockAdapter();
    const manusClient = createMockManusClient();

    // --- Step 1: Simulate inbound message persistence ---
    const session = await inboundStore.upsertSession({
      channelUserId: TEST_JID,
      channelChatId: TEST_JID,
      lastActivityAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const inboundMsg = await inboundStore.persistInboundMessage({
      sessionId: session.id,
      channelMessageId: `wa-msg-${randomUUID().slice(0, 8)}`,
      senderId: TEST_JID,
      contentText: "Summarize the latest AI news",
      contentJson: { provider: "whatsapp" },
      createdAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(inboundMsg.inserted).toBe(true);

    // --- Step 2: Dispatch inbound → router (no active tasks) → create new task ---
    const classifier = { classify: vi.fn() };
    const router = new TaskRouter(classifier, taskRouterStore);

    const dispatch = await dispatchInboundMessage(
      {
        sessionId: session.id,
        inboundMessageId: inboundMsg.id!,
        chatId: TEST_JID,
        senderId: "assistant",
        text: "Summarize the latest AI news",
        attachments: [],
      },
      {
        activeTaskStore: taskRouterStore,
        router,
        manusClient,
        taskStateStore: eventProcessorStore,
        whatsappAdapter: adapter,
        taskCreationStore,
      },
    );

    expect(dispatch.action).toBe("new");
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(adapter.sentTexts).toHaveLength(1);
    expect(adapter.sentTexts[0]!.text).toContain("Got it");

    // --- Step 3: Verify task row was persisted ---
    const taskRows = await db
      .select()
      .from(manusTasks)
      .where(eq(manusTasks.sessionId, session.id));

    expect(taskRows).toHaveLength(1);
    expect(taskRows[0]!.status).toBe("pending");
    expect(taskRows[0]!.taskId).toBe(dispatch.taskId);

    // --- Step 4: Simulate Manus webhook: task_stopped + finish ---
    const eventProcessor = createEventProcessor({
      store: eventProcessorStore,
      whatsappAdapter: adapter,
      downloadAttachment: vi.fn().mockResolvedValue({
        buffer: Buffer.from("pdf-content"),
        contentType: "application/pdf",
      }),
    });

    const webhookResult = await handleManusWebhook({
      providedSecret: "test-secret",
      expectedSecret: "test-secret",
      payload: {
        event_id: `evt-${randomUUID().slice(0, 8)}`,
        event_type: "task_stopped",
        task_detail: {
          task_id: dispatch.taskId,
          task_title: "AI News Summary",
          task_url: "https://manus.im/app/test",
          message: "Here is the summary of the latest AI news.",
          stop_reason: "finish",
          attachments: [
            {
              file_name: "summary.pdf",
              url: "https://example.com/summary.pdf",
              size_bytes: 11,
            },
          ],
        },
      },
      lifecycleStore: eventProcessorStore,
      eventProcessor,
    });

    expect(webhookResult.status).toBe(200);
    expect(webhookResult.body.status).toBe("processed");

    // --- Step 5: Verify task status updated to completed ---
    const updatedTask = await db
      .select()
      .from(manusTasks)
      .where(eq(manusTasks.taskId, dispatch.taskId));

    expect(updatedTask[0]!.status).toBe("completed");
    expect(updatedTask[0]!.stopReason).toBe("finish");
    expect(updatedTask[0]!.stoppedAt).not.toBeNull();

    // --- Step 6: Verify outbound text + media were sent ---
    expect(adapter.sentTexts).toHaveLength(2); // ack + finish reply
    expect(adapter.sentTexts[1]!.text).toContain("summary of the latest AI news");
    expect(adapter.sentMedia).toHaveLength(1);
    expect(adapter.sentMedia[0]!.fileName).toBe("summary.pdf");

    // --- Step 7: Verify attachment metadata persisted ---
    const attachments = await db
      .select()
      .from(manusAttachments)
      .where(eq(manusAttachments.taskId, dispatch.taskId));

    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.fileName).toBe("summary.pdf");
    expect(attachments[0]!.mimeType).toBe("application/pdf");
  });
});

// ---------------------------------------------------------------------------
// Test: Ask → reply → continue → finish
// ---------------------------------------------------------------------------

describe("Integration: Ask/continue flow", () => {
  it("inbound → task → webhook ask → user reply → continue → finish", async () => {
    const adapter = createMockAdapter();
    const manusClient = createMockManusClient();
    const classifier = { classify: vi.fn() };
    const router = new TaskRouter(classifier, taskRouterStore);

    // --- Step 1: Create session + inbound message ---
    const session = await inboundStore.upsertSession({
      channelUserId: TEST_JID,
      channelChatId: TEST_JID,
      lastActivityAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const inbound1 = await inboundStore.persistInboundMessage({
      sessionId: session.id,
      channelMessageId: `wa-msg-${randomUUID().slice(0, 8)}`,
      senderId: TEST_JID,
      contentText: "Book a restaurant",
      contentJson: { provider: "whatsapp" },
      createdAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    // --- Step 2: Dispatch → new task ---
    const dispatch1 = await dispatchInboundMessage(
      {
        sessionId: session.id,
        inboundMessageId: inbound1.id!,
        chatId: TEST_JID,
        senderId: "assistant",
        text: "Book a restaurant",
        attachments: [],
      },
      {
        activeTaskStore: taskRouterStore,
        router,
        manusClient,
        taskStateStore: eventProcessorStore,
        whatsappAdapter: adapter,
        taskCreationStore,
      },
    );

    expect(dispatch1.action).toBe("new");

    // --- Step 3: Webhook → ask ---
    const askEventId = `evt-ask-${randomUUID().slice(0, 8)}`;
    const eventProcessor = createEventProcessor({
      store: eventProcessorStore,
      whatsappAdapter: adapter,
    });

    await handleManusWebhook({
      providedSecret: "s",
      expectedSecret: "s",
      payload: {
        event_id: askEventId,
        event_type: "task_stopped",
        task_detail: {
          task_id: dispatch1.taskId,
          task_title: "Restaurant booking",
          message: "Italian or Japanese?",
          stop_reason: "ask",
        },
      },
      lifecycleStore: eventProcessorStore,
      eventProcessor,
    });

    // Verify task is waiting_user
    const waitingTask = await db
      .select()
      .from(manusTasks)
      .where(eq(manusTasks.taskId, dispatch1.taskId));

    expect(waitingTask[0]!.status).toBe("waiting_user");
    expect(waitingTask[0]!.stopReason).toBe("ask");
    expect(adapter.sentTexts.some((t) => t.text === "Italian or Japanese?")).toBe(true);

    // --- Step 4: User replies → router auto-continues (single waiting_user + ask) ---
    const inbound2 = await inboundStore.persistInboundMessage({
      sessionId: session.id,
      channelMessageId: `wa-msg-${randomUUID().slice(0, 8)}`,
      senderId: TEST_JID,
      contentText: "Japanese please",
      contentJson: { provider: "whatsapp" },
      createdAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const dispatch2 = await dispatchInboundMessage(
      {
        sessionId: session.id,
        inboundMessageId: inbound2.id!,
        chatId: TEST_JID,
        senderId: "assistant",
        text: "Japanese please",
        attachments: [],
      },
      {
        activeTaskStore: taskRouterStore,
        router,
        manusClient,
        taskStateStore: eventProcessorStore,
        whatsappAdapter: adapter,
        taskCreationStore,
      },
    );

    expect(dispatch2.action).toBe("continue");
    expect(dispatch2.taskId).toBe(dispatch1.taskId);
    expect(classifier.classify).not.toHaveBeenCalled(); // short-circuit

    // Verify continueTask was called
    const continueCall = manusClient.calls.find((c) => c.taskId === dispatch1.taskId);
    expect(continueCall).toBeTruthy();

    // Verify task is back to running
    const runningTask = await db
      .select()
      .from(manusTasks)
      .where(eq(manusTasks.taskId, dispatch1.taskId));

    expect(runningTask[0]!.status).toBe("running");

    // --- Step 5: Final webhook → finish ---
    await handleManusWebhook({
      providedSecret: "s",
      expectedSecret: "s",
      payload: {
        event_id: `evt-finish-${randomUUID().slice(0, 8)}`,
        event_type: "task_stopped",
        task_detail: {
          task_id: dispatch1.taskId,
          task_title: "Restaurant booking",
          message: "Booked Sushi Nakazawa for 7pm!",
          stop_reason: "finish",
        },
      },
      lifecycleStore: eventProcessorStore,
      eventProcessor,
    });

    const finishedTask = await db
      .select()
      .from(manusTasks)
      .where(eq(manusTasks.taskId, dispatch1.taskId));

    expect(finishedTask[0]!.status).toBe("completed");
    expect(adapter.sentTexts.some((t) => t.text.includes("Sushi Nakazawa"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test: Duplicate webhook is idempotent
// ---------------------------------------------------------------------------

describe("Integration: Webhook idempotency", () => {
  it("duplicate event_id is accepted but not reprocessed", async () => {
    const adapter = createMockAdapter();

    // Create minimal task for the webhook to reference
    const session = await inboundStore.upsertSession({
      channelUserId: TEST_JID,
      channelChatId: TEST_JID,
      lastActivityAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const inboundMsg = await inboundStore.persistInboundMessage({
      sessionId: session.id,
      channelMessageId: `wa-msg-${randomUUID().slice(0, 8)}`,
      senderId: TEST_JID,
      contentText: "test",
      contentJson: {},
      createdAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await taskCreationStore.createTaskRecord({
      sessionId: session.id,
      taskId: "dedup-task",
      createdByMessageId: inboundMsg.id!,
      taskTitle: "Test",
      taskUrl: null,
      agentProfile: "manus-1.6",
      createdAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const eventProcessor = createEventProcessor({
      store: eventProcessorStore,
      whatsappAdapter: adapter,
    });

    const eventId = `evt-dedup-${randomUUID().slice(0, 8)}`;
    const payload = {
      event_id: eventId,
      event_type: "task_stopped",
      task_detail: {
        task_id: "dedup-task",
        message: "Done",
        stop_reason: "finish",
      },
    };

    // First delivery
    const r1 = await handleManusWebhook({
      providedSecret: "s",
      expectedSecret: "s",
      payload,
      lifecycleStore: eventProcessorStore,
      eventProcessor,
    });

    expect(r1.body.status).toBe("processed");

    // Second delivery (duplicate)
    const r2 = await handleManusWebhook({
      providedSecret: "s",
      expectedSecret: "s",
      payload,
      lifecycleStore: eventProcessorStore,
      eventProcessor,
    });

    expect(r2.body.status).toBe("duplicate");
    // Should have sent the text only once
    const finishTexts = adapter.sentTexts.filter((t) => t.text === "Done");
    expect(finishTexts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test: Inbound dedupe
// ---------------------------------------------------------------------------

describe("Integration: Inbound message dedupe", () => {
  it("rejects duplicate channel_message_id at DB level", async () => {
    const session = await inboundStore.upsertSession({
      channelUserId: TEST_JID,
      channelChatId: TEST_JID,
      lastActivityAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const messageId = `wa-dedup-${randomUUID().slice(0, 8)}`;

    const first = await inboundStore.persistInboundMessage({
      sessionId: session.id,
      channelMessageId: messageId,
      senderId: TEST_JID,
      contentText: "hello",
      contentJson: {},
      createdAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(first.inserted).toBe(true);

    const second = await inboundStore.persistInboundMessage({
      sessionId: session.id,
      channelMessageId: messageId,
      senderId: TEST_JID,
      contentText: "hello again",
      contentJson: {},
      createdAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(second.inserted).toBe(false);
    expect(second.id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test: Session upsert idempotency
// ---------------------------------------------------------------------------

describe("Integration: Session upsert", () => {
  it("returns same session ID for same channel/user/chat", async () => {
    const s1 = await inboundStore.upsertSession({
      channelUserId: TEST_JID,
      channelChatId: TEST_JID,
      lastActivityAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const s2 = await inboundStore.upsertSession({
      channelUserId: TEST_JID,
      channelChatId: TEST_JID,
      lastActivityAt: now(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(s1.id).toBe(s2.id);
  });
});
