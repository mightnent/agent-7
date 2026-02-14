import { describe, expect, it, vi } from "vitest";

import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";
import type { WhatsAppMediaAttachment } from "@/lib/channel/whatsapp-types";
import type { ConnectorResolver } from "@/lib/connectors/resolver";
import { ManusApiError } from "@/lib/manus/client";
import type { ManusClient } from "@/lib/manus/client";
import { TaskRouter } from "@/lib/routing/task-router";
import type { ActiveTaskQueryStore } from "@/lib/routing/task-router.store";

import { dispatchInboundMessage } from "./inbound-dispatch";
import { inboundDispatchConstants } from "./inbound-dispatch";
import type { TaskCreationStore } from "./task-creation.store";
import type { TaskStateStore } from "./inbound-dispatch";

const createBaseDeps = () => {
  const activeTaskStore: ActiveTaskQueryStore = {
    listActiveTasks: vi.fn(),
  };

  const classifier = {
    classify: vi.fn(),
  };

  const router = new TaskRouter(classifier);
  const connectorResolver: ConnectorResolver = {
    resolve: vi.fn(),
  };

  const manusClient = {
    continueTask: vi.fn(),
    createTask: vi.fn(),
  } as unknown as ManusClient;

  const taskStateStore: TaskStateStore = {
    markTaskRunning: vi.fn(),
  };

  const whatsappAdapter: WhatsAppAdapter = {
    sendTextMessage: vi.fn(),
    sendMediaMessage: vi.fn(),
    setTyping: vi.fn(),
  };

  const taskCreationStore: TaskCreationStore = {
    createTaskRecord: vi.fn(),
    linkInboundMessageToTask: vi.fn(),
    createOutboundMessage: vi.fn(),
  };

  return {
    activeTaskStore,
    classifier,
    router,
    connectorResolver,
    manusClient,
    taskStateStore,
    whatsappAdapter,
    taskCreationStore,
  };
};

const sampleAttachment: WhatsAppMediaAttachment = {
  kind: "image",
  mimetype: "image/png",
  fileName: "image.png",
  sizeBytes: 3,
  buffer: Buffer.from("abc"),
};

describe("dispatchInboundMessage", () => {
  it("continues existing task when router returns continue", async () => {
    const deps = createBaseDeps();
    vi.mocked(deps.activeTaskStore.listActiveTasks).mockResolvedValue([
      {
        taskId: "task-1",
        taskTitle: "Report",
        originalPrompt: "Build report",
        status: "waiting_user",
        stopReason: "ask",
        lastMessage: "Pick an option",
      },
    ]);
    vi.mocked(deps.connectorResolver.resolve).mockResolvedValue({
      connectorUids: ["clickup-uid"],
      confidence: 0.9,
      reason: "matched_catalog_name",
      source: "catalog_name",
    });

    const result = await dispatchInboundMessage(
      {
        sessionId: "session-1",
        inboundMessageId: "message-1",
        chatId: "1555@s.whatsapp.net",
        senderId: "assistant",
        text: "Choose option 2",
        attachments: [],
      },
      deps,
    );

    expect(vi.mocked(deps.manusClient.continueTask)).toHaveBeenCalledWith(
      "task-1",
      "Choose option 2",
      expect.objectContaining({
        taskMode: "adaptive",
        interactiveMode: true,
        connectors: ["clickup-uid"],
      }),
    );

    expect(vi.mocked(deps.taskStateStore.markTaskRunning)).toHaveBeenCalledWith("task-1", expect.any(Date));
    expect(result).toEqual({
      action: "continue",
      taskId: "task-1",
      reason: "single_waiting_user_task",
    });
  });

  it("creates a new task when router returns new", async () => {
    const deps = createBaseDeps();
    vi.mocked(deps.activeTaskStore.listActiveTasks).mockResolvedValue([]);
    vi.mocked(deps.connectorResolver.resolve).mockResolvedValue({
      connectorUids: ["clickup-uid"],
      confidence: 0.9,
      reason: "matched_catalog_name",
      source: "catalog_name",
    });
    vi.mocked(deps.manusClient.createTask).mockResolvedValue({
      task_id: "task-new",
      task_title: "Analyze image",
      task_url: "https://manus.im/app/task-new",
    });
    vi.mocked(deps.taskCreationStore.createOutboundMessage).mockResolvedValue("outbound-1");

    const result = await dispatchInboundMessage(
      {
        sessionId: "session-2",
        inboundMessageId: "message-2",
        chatId: "1555@s.whatsapp.net",
        senderId: "assistant",
        text: null,
        attachments: [sampleAttachment],
      },
      deps,
    );

    expect(vi.mocked(deps.manusClient.createTask)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.manusClient.createTask)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        connectors: ["clickup-uid"],
      }),
    );
    expect(result.action).toBe("new");
    expect(result.taskId).toBe("task-new");
  });

  it("falls back to creating a new task when continueTask returns task-not-found 404", async () => {
    const deps = createBaseDeps();
    vi.mocked(deps.activeTaskStore.listActiveTasks).mockResolvedValue([
      {
        taskId: "task-missing",
        taskTitle: "Missing Task",
        originalPrompt: "Old prompt",
        status: "waiting_user",
        stopReason: "ask",
        lastMessage: "Need input",
      },
    ]);
    vi.mocked(deps.connectorResolver.resolve).mockResolvedValue({
      connectorUids: ["clickup-uid"],
      confidence: 0.9,
      reason: "matched_catalog_name",
      source: "catalog_name",
    });

    vi.mocked(deps.manusClient.continueTask).mockRejectedValue(
      new ManusApiError("Manus request failed with status 404", 404, '{"code":5,"message":"task not found"}'),
    );
    vi.mocked(deps.manusClient.createTask).mockResolvedValue({
      task_id: "task-new-after-404",
      task_title: "Recovered Task",
      task_url: "https://manus.im/app/task-new-after-404",
    });
    vi.mocked(deps.taskCreationStore.createOutboundMessage).mockResolvedValue("outbound-2");

    const result = await dispatchInboundMessage(
      {
        sessionId: "session-3",
        inboundMessageId: "message-3",
        chatId: "1555@s.whatsapp.net",
        senderId: "assistant",
        text: "continue please",
        attachments: [],
      },
      deps,
    );

    expect(vi.mocked(deps.manusClient.continueTask)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.manusClient.createTask)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.taskStateStore.markTaskRunning)).not.toHaveBeenCalled();
    expect(result).toEqual({
      action: "new",
      taskId: "task-new-after-404",
      reason: inboundDispatchConstants.CONTINUE_TASK_NOT_FOUND_FALLBACK_REASON,
      ackMessageId: "outbound-2",
      ackText: 'Got it - working on "Recovered Task" now.',
    });
  });
});
