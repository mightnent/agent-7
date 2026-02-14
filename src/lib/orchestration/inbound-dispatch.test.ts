import { describe, expect, it, vi } from "vitest";

import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";
import type { WhatsAppMediaAttachment } from "@/lib/channel/whatsapp-types";
import type { ManusClient } from "@/lib/manus/client";
import { TaskRouter } from "@/lib/routing/task-router";
import type { ActiveTaskQueryStore } from "@/lib/routing/task-router.store";

import { dispatchInboundMessage } from "./inbound-dispatch";
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
    expect(result.action).toBe("new");
    expect(result.taskId).toBe("task-new");
  });
});
