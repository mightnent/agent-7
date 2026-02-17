import { describe, expect, it, vi } from "vitest";

import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";
import type { ManusClient } from "@/lib/manus/client";
import type { PersonalityMessageRenderer } from "@/lib/orchestration/personality";

import {
  createTaskFromInboundMessage,
  taskCreationConstants,
  type ManusProjectSettingsStore,
} from "./task-creation";
import type { TaskCreationStore } from "./task-creation.store";

const createMocks = (): {
  manusClient: ManusClient;
  store: TaskCreationStore;
  whatsappAdapter: WhatsAppAdapter;
  projectSettingsStore: ManusProjectSettingsStore;
  personalityRenderer: PersonalityMessageRenderer;
} => {
  const manusClient = {
    createTask: vi.fn(),
    createProject: vi.fn(),
  } as unknown as ManusClient;

  const store = {
    createTaskRecord: vi.fn(),
    linkInboundMessageToTask: vi.fn(),
    createOutboundMessage: vi.fn(),
  } as unknown as TaskCreationStore;

  const whatsappAdapter = {
    sendTextMessage: vi.fn(),
    sendMediaMessage: vi.fn(),
    setTyping: vi.fn(),
  } as unknown as WhatsAppAdapter;

  const projectSettingsStore = {
    getProjectId: vi.fn().mockResolvedValue("project-1"),
    getProjectInstructions: vi.fn().mockResolvedValue(""),
    setProjectId: vi.fn(),
  };

  const personalityRenderer = {
    buildTaskAcknowledgement: vi.fn().mockResolvedValue(null),
    frameTaskResult: vi.fn().mockResolvedValue(null),
  };

  return {
    manusClient,
    store,
    whatsappAdapter,
    projectSettingsStore,
    personalityRenderer,
  };
};

describe("createTaskFromInboundMessage", () => {
  it("creates task, links inbound message, and sends acknowledgement", async () => {
    const deps = createMocks();
    vi.mocked(deps.manusClient.createTask).mockResolvedValue({
      task_id: "task-123",
      task_title: "Analyze receipt",
      task_url: "https://manus.im/app/task-123",
    });
    vi.mocked(deps.store.createOutboundMessage).mockResolvedValue("outbound-1");

    const now = new Date("2026-02-13T12:00:00.000Z");

    const result = await createTaskFromInboundMessage(
      {
        sessionId: "session-1",
        inboundMessageId: "inbound-1",
        chatId: "15551234567@s.whatsapp.net",
        text: "Please summarize this",
        attachments: [
          {
            kind: "image",
            mimetype: "image/png",
            fileName: "img.png",
            sizeBytes: 3,
            buffer: Buffer.from("abc"),
          },
        ],
        senderId: "assistant",
        now: () => now,
      },
      {
        ...deps,
        projectSettingsStore: deps.projectSettingsStore,
        personalityRenderer: deps.personalityRenderer,
      },
    );

    expect(vi.mocked(deps.manusClient.createTask)).toHaveBeenCalledWith(
      "Please summarize this",
      expect.objectContaining({
        taskMode: "adaptive",
        interactiveMode: true,
        hideInTaskList: true,
        attachments: [
          {
            filename: "img.png",
            fileData: "data:image/png;base64,YWJj",
          },
        ],
        projectId: "project-1",
      }),
    );

    expect(vi.mocked(deps.store.linkInboundMessageToTask)).toHaveBeenCalledWith({
      messageId: "inbound-1",
      taskId: "task-123",
      routeReason: taskCreationConstants.DEFAULT_ROUTE_REASON,
    });

    expect(vi.mocked(deps.whatsappAdapter.sendTextMessage)).toHaveBeenCalledWith(
      "15551234567@s.whatsapp.net",
      'Got it - working on "Analyze receipt" now.',
    );
    expect(vi.mocked(deps.store.createOutboundMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        manusTaskId: "task-123",
      }),
    );

    expect(result).toEqual({
      taskId: "task-123",
      taskTitle: "Analyze receipt",
      taskUrl: "https://manus.im/app/task-123",
      ackMessageId: "outbound-1",
      ackText: 'Got it - working on "Analyze receipt" now.',
    });
  });

  it("uses fallback prompt when inbound message has only media", async () => {
    const deps = createMocks();
    vi.mocked(deps.manusClient.createTask).mockResolvedValue({
      task_id: "task-456",
      task_title: "Media task",
      task_url: "https://manus.im/app/task-456",
    });
    vi.mocked(deps.store.createOutboundMessage).mockResolvedValue("outbound-2");

    await createTaskFromInboundMessage(
      {
        sessionId: "session-2",
        inboundMessageId: "inbound-2",
        chatId: "15551234567@s.whatsapp.net",
        text: null,
        attachments: [
          {
            kind: "document",
            mimetype: "application/pdf",
            fileName: "report.pdf",
            sizeBytes: 5,
            buffer: Buffer.from("hello"),
          },
        ],
        senderId: "assistant",
      },
      {
        ...deps,
        projectSettingsStore: deps.projectSettingsStore,
        personalityRenderer: deps.personalityRenderer,
      },
    );

    expect(vi.mocked(deps.manusClient.createTask)).toHaveBeenCalledWith(
      taskCreationConstants.DEFAULT_PROMPT_FOR_MEDIA,
      expect.any(Object),
    );
  });

  it("passes resolved connectors to Manus createTask", async () => {
    const deps = createMocks();
    vi.mocked(deps.manusClient.createTask).mockResolvedValue({
      task_id: "task-connector",
      task_title: "Connector task",
      task_url: "https://manus.im/app/task-connector",
    });
    vi.mocked(deps.store.createOutboundMessage).mockResolvedValue("outbound-connector");

    await createTaskFromInboundMessage(
      {
        sessionId: "session-connector",
        inboundMessageId: "inbound-connector",
        chatId: "15551234567@s.whatsapp.net",
        text: "Check backlog",
        attachments: [],
        senderId: "assistant",
        connectors: ["clickup-uid"],
      },
      {
        ...deps,
        projectSettingsStore: deps.projectSettingsStore,
        personalityRenderer: deps.personalityRenderer,
      },
    );

    expect(vi.mocked(deps.manusClient.createTask)).toHaveBeenCalledWith(
      "Check backlog",
      expect.objectContaining({
        connectors: ["clickup-uid"],
      }),
    );
  });

  it("falls back to prompt-derived title when Manus returns blank title", async () => {
    const deps = createMocks();
    vi.mocked(deps.manusClient.createTask).mockResolvedValue({
      task_id: "task-789",
      task_title: "",
      task_url: "https://manus.im/app/task-789",
    });
    vi.mocked(deps.store.createOutboundMessage).mockResolvedValue("outbound-3");

    const result = await createTaskFromInboundMessage(
      {
        sessionId: "session-3",
        inboundMessageId: "inbound-3",
        chatId: "15551234567@s.whatsapp.net",
        text: "Need help drafting an email about project status",
        attachments: [],
        senderId: "assistant",
      },
      {
        ...deps,
        projectSettingsStore: deps.projectSettingsStore,
        personalityRenderer: deps.personalityRenderer,
      },
    );

    expect(result.taskTitle).toBe("Need help drafting an email about project status");
    expect(result.ackText).toBe('Got it - working on "Need help drafting an email about project status" now.');
  });

  it("creates project on first task when project_id is missing", async () => {
    const deps = createMocks();
    vi.mocked(deps.projectSettingsStore.getProjectId).mockResolvedValue(null);
    vi.mocked(deps.projectSettingsStore.getProjectInstructions).mockResolvedValue("## User context");
    vi.mocked(deps.manusClient.createProject).mockResolvedValue({
      project_id: "project-new",
      name: "Agent-7",
    });
    vi.mocked(deps.manusClient.createTask).mockResolvedValue({
      task_id: "task-new",
      task_title: "New task",
      task_url: "https://manus.im/app/task-new",
    });
    vi.mocked(deps.store.createOutboundMessage).mockResolvedValue("outbound-new");

    await createTaskFromInboundMessage(
      {
        sessionId: "session-new",
        inboundMessageId: "inbound-new",
        chatId: "15551234567@s.whatsapp.net",
        text: "Do this",
        attachments: [],
        senderId: "assistant",
      },
      {
        ...deps,
        projectSettingsStore: deps.projectSettingsStore,
        personalityRenderer: deps.personalityRenderer,
      },
    );

    expect(vi.mocked(deps.manusClient.createProject)).toHaveBeenCalledWith({
      name: "Agent-7",
      instruction: "## User context",
    });
    expect(vi.mocked(deps.projectSettingsStore.setProjectId)).toHaveBeenCalledWith("project-new");
    expect(vi.mocked(deps.manusClient.createTask)).toHaveBeenCalledWith(
      "Do this",
      expect.objectContaining({
        projectId: "project-new",
      }),
    );
  });

  it("uses personality acknowledgement when available", async () => {
    const deps = createMocks();
    vi.mocked(deps.manusClient.createTask).mockResolvedValue({
      task_id: "task-personality",
      task_title: "Personalized",
      task_url: "https://manus.im/app/task-personality",
    });
    vi.mocked(deps.personalityRenderer.buildTaskAcknowledgement).mockResolvedValue("On it. I'll update you shortly.");
    vi.mocked(deps.store.createOutboundMessage).mockResolvedValue("outbound-personality");

    const result = await createTaskFromInboundMessage(
      {
        sessionId: "session-personality",
        inboundMessageId: "inbound-personality",
        chatId: "15551234567@s.whatsapp.net",
        text: "Please handle this",
        attachments: [],
        senderId: "assistant",
      },
      {
        ...deps,
        projectSettingsStore: deps.projectSettingsStore,
        personalityRenderer: deps.personalityRenderer,
      },
    );

    expect(result.ackText).toBe("On it. I'll update you shortly.");
    expect(vi.mocked(deps.whatsappAdapter.sendTextMessage)).toHaveBeenCalledWith(
      "15551234567@s.whatsapp.net",
      "On it. I'll update you shortly.",
    );
  });
});
