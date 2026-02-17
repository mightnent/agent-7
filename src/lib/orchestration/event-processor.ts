import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";
import type { PersonalityMessageRenderer } from "@/lib/orchestration/personality";

import type { EventProcessorStore } from "./event-processor.store";

const MESSAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ATTACHMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ManusWebhookEventType = "task_created" | "task_progress" | "task_stopped";

export interface ManusTaskAttachmentPayload {
  file_name: string;
  url: string;
  size_bytes: number;
}

export interface ManusTaskDetailPayload {
  task_id: string;
  task_title?: string;
  task_url?: string;
  message?: string;
  attachments?: ManusTaskAttachmentPayload[];
  stop_reason?: "finish" | "ask";
}

export interface ManusProgressDetailPayload {
  task_id: string;
  progress_type: string;
  message: string;
}

export interface ManusWebhookPayload {
  event_id: string;
  event_type: ManusWebhookEventType;
  task_detail?: ManusTaskDetailPayload;
  progress_detail?: ManusProgressDetailPayload;
  [key: string]: unknown;
}

export interface ParsedManusWebhookEvent {
  eventId: string;
  eventType: ManusWebhookEventType;
  taskId: string;
  progressType: string | null;
  stopReason: "finish" | "ask" | null;
  payload: ManusWebhookPayload;
  taskDetail?: ManusTaskDetailPayload;
  progressDetail?: ManusProgressDetailPayload;
}

export interface DownloadedAttachment {
  buffer: Buffer;
  contentType: string | null;
}

export interface EventProcessor {
  process(event: ParsedManusWebhookEvent): Promise<void>;
}

const mimeFromExtension = (fileName: string): string => {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".mp4")) return "video/mp4";
  if (normalized.endsWith(".mov")) return "video/quicktime";
  if (normalized.endsWith(".mp3")) return "audio/mpeg";
  if (normalized.endsWith(".m4a")) return "audio/mp4";
  if (normalized.endsWith(".wav")) return "audio/wav";
  if (normalized.endsWith(".ogg")) return "audio/ogg";
  if (normalized.endsWith(".pdf")) return "application/pdf";
  if (normalized.endsWith(".csv")) return "text/csv";
  if (normalized.endsWith(".txt")) return "text/plain";
  if (normalized.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  return "application/octet-stream";
};

const defaultDownloadAttachment = async (url: string): Promise<DownloadedAttachment> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download attachment: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type"),
  };
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const parseManusWebhookPayload = (payload: unknown): ParsedManusWebhookEvent | null => {
  const body = toRecord(payload);
  const eventId = readString(body.event_id);
  const eventType = readString(body.event_type) as ManusWebhookEventType | null;

  if (!eventId || !eventType) {
    return null;
  }

  if (eventType === "task_created" || eventType === "task_stopped") {
    const taskDetailRaw = toRecord(body.task_detail);
    const taskId = readString(taskDetailRaw.task_id);
    if (!taskId) {
      return null;
    }

    const stopReasonRaw = readString(taskDetailRaw.stop_reason);
    const stopReason = stopReasonRaw === "finish" || stopReasonRaw === "ask" ? stopReasonRaw : null;

    const taskDetail: ManusTaskDetailPayload = {
      task_id: taskId,
      task_title: readString(taskDetailRaw.task_title) ?? undefined,
      task_url: readString(taskDetailRaw.task_url) ?? undefined,
      message: readString(taskDetailRaw.message) ?? undefined,
      attachments: Array.isArray(taskDetailRaw.attachments)
        ? taskDetailRaw.attachments
            .map((attachmentRaw) => {
              const attachment = toRecord(attachmentRaw);
              const fileName = readString(attachment.file_name);
              const url = readString(attachment.url);
              const size = attachment.size_bytes;
              if (!fileName || !url || typeof size !== "number") {
                return null;
              }

              return {
                file_name: fileName,
                url,
                size_bytes: size,
              } satisfies ManusTaskAttachmentPayload;
            })
            .filter((attachment): attachment is ManusTaskAttachmentPayload => attachment !== null)
        : [],
      stop_reason: stopReason ?? undefined,
    };

    return {
      eventId,
      eventType,
      taskId,
      progressType: null,
      stopReason,
      payload: body as ManusWebhookPayload,
      taskDetail,
    };
  }

  if (eventType === "task_progress") {
    const progressDetailRaw = toRecord(body.progress_detail);
    const taskId = readString(progressDetailRaw.task_id);
    const progressType = readString(progressDetailRaw.progress_type);
    const message = readString(progressDetailRaw.message);

    if (!taskId || !progressType || !message) {
      return null;
    }

    const progressDetail: ManusProgressDetailPayload = {
      task_id: taskId,
      progress_type: progressType,
      message,
    };

    return {
      eventId,
      eventType,
      taskId,
      progressType,
      stopReason: null,
      payload: body as ManusWebhookPayload,
      progressDetail,
    };
  }

  return null;
};

export interface EventProcessorDeps {
  store: EventProcessorStore;
  whatsappAdapter: WhatsAppAdapter;
  personalityRenderer?: PersonalityMessageRenderer;
  downloadAttachment?: (url: string) => Promise<DownloadedAttachment>;
  sendProgressUpdates?: boolean;
  now?: () => Date;
}

export const createEventProcessor = (deps: EventProcessorDeps): EventProcessor => {
  const now = deps.now ?? (() => new Date());
  const downloadAttachment = deps.downloadAttachment ?? defaultDownloadAttachment;
  const sendProgressUpdates = deps.sendProgressUpdates ?? false;

  return {
    async process(event: ParsedManusWebhookEvent): Promise<void> {
      const eventTime = now();

      if (event.eventType === "task_created") {
        await deps.store.updateTaskFromCreated({
          taskId: event.taskId,
          taskTitle: event.taskDetail?.task_title ?? null,
          taskUrl: event.taskDetail?.task_url ?? null,
          updatedAt: eventTime,
        });
        return;
      }

      if (event.eventType === "task_progress") {
        const currentStatus = await deps.store.getTaskStatus(event.taskId);
        if (currentStatus === "completed" || currentStatus === "failed" || currentStatus === "waiting_user") {
          return;
        }

        await deps.store.updateTaskFromProgress({
          taskId: event.taskId,
          message: event.progressDetail?.message ?? null,
          updatedAt: eventTime,
        });

        if (!sendProgressUpdates) {
          return;
        }

        const context = await deps.store.getTaskDeliveryContext(event.taskId);
        if (!context || !event.progressDetail?.message) {
          return;
        }

        await deps.whatsappAdapter.sendTextMessage(context.chatId, event.progressDetail.message);
        await deps.store.createOutboundMessage({
          sessionId: context.sessionId,
          manusTaskId: event.taskId,
          senderId: "assistant",
          contentText: event.progressDetail.message,
          contentJson: {
            provider: "whatsapp",
            type: "task_progress",
            eventId: event.eventId,
          },
          createdAt: eventTime,
          expiresAt: new Date(eventTime.getTime() + MESSAGE_TTL_MS),
        });
        return;
      }

      const detail = event.taskDetail;
      if (!detail) {
        throw new Error("task_stopped event missing task_detail");
      }

      if (detail.stop_reason === "ask") {
        await deps.store.updateTaskFromStoppedAsk({
          taskId: event.taskId,
          taskTitle: detail.task_title ?? null,
          taskUrl: detail.task_url ?? null,
          message: detail.message ?? null,
          updatedAt: eventTime,
        });

        const context = await deps.store.getTaskDeliveryContext(event.taskId);
        if (!context || !detail.message) {
          return;
        }

        await deps.whatsappAdapter.sendTextMessage(context.chatId, detail.message);
        await deps.store.createOutboundMessage({
          sessionId: context.sessionId,
          manusTaskId: event.taskId,
          senderId: "assistant",
          contentText: detail.message,
          contentJson: {
            provider: "whatsapp",
            type: "task_ask",
            eventId: event.eventId,
          },
          createdAt: eventTime,
          expiresAt: new Date(eventTime.getTime() + MESSAGE_TTL_MS),
        });
        return;
      }

      await deps.store.updateTaskFromStoppedFinish({
        taskId: event.taskId,
        taskTitle: detail.task_title ?? null,
        taskUrl: detail.task_url ?? null,
        message: detail.message ?? null,
        updatedAt: eventTime,
        stoppedAt: eventTime,
      });

      const context = await deps.store.getTaskDeliveryContext(event.taskId);
      if (!context) {
        return;
      }

      if (detail.message) {
        const formatted =
          (await deps.personalityRenderer?.frameTaskResult({ resultText: detail.message })) ?? detail.message;

        await deps.whatsappAdapter.sendTextMessage(context.chatId, formatted);
        await deps.store.createOutboundMessage({
          sessionId: context.sessionId,
          manusTaskId: event.taskId,
          senderId: "assistant",
          contentText: formatted,
          contentJson: {
            provider: "whatsapp",
            type: "task_finish",
            eventId: event.eventId,
          },
          createdAt: eventTime,
          expiresAt: new Date(eventTime.getTime() + MESSAGE_TTL_MS),
        });
      }

      const attachments = detail.attachments ?? [];
      if (attachments.length === 0) {
        return;
      }

      const attachmentRecords: Array<{
        taskId: string;
        eventId: string;
        fileName: string;
        url: string;
        sizeBytes: bigint;
        mimeType: string | null;
        createdAt: Date;
        expiresAt: Date;
      }> = [];

      for (const attachment of attachments) {
        const downloaded = await downloadAttachment(attachment.url);
        const mimeType = downloaded.contentType ?? mimeFromExtension(attachment.file_name);

        await deps.whatsappAdapter.sendMediaMessage(context.chatId, {
          buffer: downloaded.buffer,
          mimetype: mimeType,
          fileName: attachment.file_name,
        });

        attachmentRecords.push({
          taskId: event.taskId,
          eventId: event.eventId,
          fileName: attachment.file_name,
          url: attachment.url,
          sizeBytes: BigInt(attachment.size_bytes),
          mimeType,
          createdAt: eventTime,
          expiresAt: new Date(eventTime.getTime() + ATTACHMENT_TTL_MS),
        });
      }

      await deps.store.createAttachmentRecords(attachmentRecords);
    },
  };
};
