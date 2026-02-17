import { describe, expect, it, vi } from "vitest";

import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";
import type { PersonalityMessageRenderer } from "@/lib/orchestration/personality";

import { createEventProcessor, parseManusWebhookPayload } from "./event-processor";
import type { EventProcessorStore } from "./event-processor.store";

const createStoreMock = (): EventProcessorStore => ({
  getTaskDeliveryContext: vi.fn(),
  getTaskStatus: vi.fn(),
  updateTaskFromCreated: vi.fn(),
  updateTaskFromProgress: vi.fn(),
  updateTaskFromStoppedFinish: vi.fn(),
  updateTaskFromStoppedAsk: vi.fn(),
  createOutboundMessage: vi.fn(),
  createAttachmentRecords: vi.fn(),
});

const createAdapterMock = (): WhatsAppAdapter => ({
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  setTyping: vi.fn(),
});

const createPersonalityMock = (): PersonalityMessageRenderer => ({
  buildTaskAcknowledgement: vi.fn(),
  frameTaskResult: vi.fn().mockResolvedValue(null),
});

describe("parseManusWebhookPayload", () => {
  it("parses task_stopped payload with details", () => {
    const parsed = parseManusWebhookPayload({
      event_id: "evt-1",
      event_type: "task_stopped",
      task_detail: {
        task_id: "task-1",
        task_title: "Report",
        task_url: "https://manus.im/app/task-1",
        message: "Done",
        stop_reason: "finish",
        attachments: [{ file_name: "report.pdf", url: "https://example.com/report.pdf", size_bytes: 123 }],
      },
    });

    expect(parsed).toMatchObject({
      eventId: "evt-1",
      eventType: "task_stopped",
      taskId: "task-1",
      stopReason: "finish",
    });
  });

  it("returns null for invalid payload", () => {
    const parsed = parseManusWebhookPayload({
      event_id: "evt-2",
      event_type: "task_progress",
      progress_detail: {
        task_id: "",
      },
    });

    expect(parsed).toBeNull();
  });
});

describe("createEventProcessor", () => {
  it("handles task_created by updating task metadata", async () => {
    const store = createStoreMock();
    const adapter = createAdapterMock();
    const processor = createEventProcessor({ store, whatsappAdapter: adapter });

    await processor.process({
      eventId: "evt-created",
      eventType: "task_created",
      taskId: "task-1",
      progressType: null,
      stopReason: null,
      payload: {
        event_id: "evt-created",
        event_type: "task_created",
      },
      taskDetail: {
        task_id: "task-1",
        task_title: "Title",
        task_url: "https://manus.im/app/task-1",
      },
    });

    expect(vi.mocked(store.updateTaskFromCreated)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(adapter.sendTextMessage)).not.toHaveBeenCalled();
  });

  it("handles task_stopped ask by messaging user and marking waiting_user", async () => {
    const store = createStoreMock();
    const adapter = createAdapterMock();
    vi.mocked(store.getTaskDeliveryContext).mockResolvedValue({
      sessionId: "session-1",
      chatId: "1555@s.whatsapp.net",
    });
    vi.mocked(store.createOutboundMessage).mockResolvedValue("out-1");

    const processor = createEventProcessor({ store, whatsappAdapter: adapter });

    await processor.process({
      eventId: "evt-ask",
      eventType: "task_stopped",
      taskId: "task-2",
      progressType: null,
      stopReason: "ask",
      payload: {
        event_id: "evt-ask",
        event_type: "task_stopped",
      },
      taskDetail: {
        task_id: "task-2",
        task_title: "Booking",
        task_url: "https://manus.im/app/task-2",
        message: "Which option do you want?",
        stop_reason: "ask",
      },
    });

    expect(vi.mocked(store.updateTaskFromStoppedAsk)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(adapter.sendTextMessage)).toHaveBeenCalledWith("1555@s.whatsapp.net", "Which option do you want?");
  });

  it("handles task_stopped finish with attachment forwarding", async () => {
    const store = createStoreMock();
    const adapter = createAdapterMock();
    const personality = createPersonalityMock();
    vi.mocked(store.getTaskDeliveryContext).mockResolvedValue({
      sessionId: "session-2",
      chatId: "1555@s.whatsapp.net",
    });
    vi.mocked(store.createOutboundMessage).mockResolvedValue("out-2");

    const processor = createEventProcessor({
      store,
      whatsappAdapter: adapter,
      personalityRenderer: personality,
      downloadAttachment: vi.fn().mockResolvedValue({
        buffer: Buffer.from("pdf"),
        contentType: "application/pdf",
      }),
    });

    await processor.process({
      eventId: "evt-finish",
      eventType: "task_stopped",
      taskId: "task-3",
      progressType: null,
      stopReason: "finish",
      payload: {
        event_id: "evt-finish",
        event_type: "task_stopped",
      },
      taskDetail: {
        task_id: "task-3",
        task_title: "Report",
        task_url: "https://manus.im/app/task-3",
        message: "Done. See attached file",
        stop_reason: "finish",
        attachments: [{
          file_name: "report.pdf",
          url: "https://example.com/report.pdf",
          size_bytes: 3,
        }],
      },
    });

    expect(vi.mocked(store.updateTaskFromStoppedFinish)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(adapter.sendTextMessage)).toHaveBeenCalledWith("1555@s.whatsapp.net", "Done. See attached file");
    expect(vi.mocked(adapter.sendMediaMessage)).toHaveBeenCalledWith(
      "1555@s.whatsapp.net",
      expect.objectContaining({
        mimetype: "application/pdf",
        fileName: "report.pdf",
      }),
    );
    expect(vi.mocked(store.createAttachmentRecords)).toHaveBeenCalledTimes(1);
  });

  it("uses personality framing for task_stopped finish message when available", async () => {
    const store = createStoreMock();
    const adapter = createAdapterMock();
    const personality = createPersonalityMock();
    vi.mocked(personality.frameTaskResult).mockResolvedValue("Framed: done");
    vi.mocked(store.getTaskDeliveryContext).mockResolvedValue({
      sessionId: "session-framed",
      chatId: "1555@s.whatsapp.net",
    });
    vi.mocked(store.createOutboundMessage).mockResolvedValue("out-framed");

    const processor = createEventProcessor({
      store,
      whatsappAdapter: adapter,
      personalityRenderer: personality,
    });

    await processor.process({
      eventId: "evt-framed",
      eventType: "task_stopped",
      taskId: "task-framed",
      progressType: null,
      stopReason: "finish",
      payload: {
        event_id: "evt-framed",
        event_type: "task_stopped",
      },
      taskDetail: {
        task_id: "task-framed",
        message: "Done",
        stop_reason: "finish",
      },
    });

    expect(vi.mocked(adapter.sendTextMessage)).toHaveBeenCalledWith("1555@s.whatsapp.net", "Framed: done");
    expect(vi.mocked(store.createOutboundMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ contentText: "Framed: done" }),
    );
  });

  it("ignores out-of-order progress events when task is already stopped", async () => {
    const store = createStoreMock();
    const adapter = createAdapterMock();
    vi.mocked(store.getTaskStatus).mockResolvedValue("completed");

    const processor = createEventProcessor({ store, whatsappAdapter: adapter, sendProgressUpdates: true });

    await processor.process({
      eventId: "evt-progress-late",
      eventType: "task_progress",
      taskId: "task-4",
      progressType: "plan_update",
      stopReason: null,
      payload: {
        event_id: "evt-progress-late",
        event_type: "task_progress",
      },
      progressDetail: {
        task_id: "task-4",
        progress_type: "plan_update",
        message: "late progress update",
      },
    });

    expect(vi.mocked(store.updateTaskFromProgress)).not.toHaveBeenCalled();
    expect(vi.mocked(adapter.sendTextMessage)).not.toHaveBeenCalled();
  });
});
