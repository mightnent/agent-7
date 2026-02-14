import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";
import type { WhatsAppMediaAttachment } from "@/lib/channel/whatsapp-types";
import type { ManusClient } from "@/lib/manus/client";
import { toManusBase64Attachments } from "@/lib/manus/client";

import type { TaskCreationStore } from "./task-creation.store";

const TASK_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MESSAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_ROUTE_REASON = "phase3-new-task-no-router";
const DEFAULT_PROMPT_FOR_MEDIA = "Please help with the attached media from the user.";
const DEFAULT_PROMPT_FOR_EMPTY_MESSAGE = "User sent an empty message. Ask for clarification and help further.";

export interface CreateTaskFromInboundInput {
  sessionId: string;
  inboundMessageId: string;
  chatId: string;
  text: string | null;
  attachments: WhatsAppMediaAttachment[];
  senderId: string;
  agentProfile?: "manus-1.6" | "manus-1.6-lite" | "manus-1.6-max";
  routeReason?: string;
  now?: () => Date;
}

export interface CreateTaskFromInboundResult {
  taskId: string;
  taskTitle: string;
  taskUrl: string;
  ackMessageId: string;
  ackText: string;
}

const titleFromPrompt = (prompt: string): string => {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (compact.length === 0) {
    return "your request";
  }

  if (compact.length <= 60) {
    return compact;
  }

  return `${compact.slice(0, 57)}...`;
};

const resolvePrompt = (text: string | null, attachments: WhatsAppMediaAttachment[]): string => {
  const trimmed = text?.trim();
  if (trimmed) {
    return trimmed;
  }

  if (attachments.length > 0) {
    return DEFAULT_PROMPT_FOR_MEDIA;
  }

  return DEFAULT_PROMPT_FOR_EMPTY_MESSAGE;
};

const buildAckText = (taskTitle: string): string => {
  return `Got it - working on "${taskTitle}" now.`;
};

export const createTaskFromInboundMessage = async (
  input: CreateTaskFromInboundInput,
  deps: {
    manusClient: ManusClient;
    store: TaskCreationStore;
    whatsappAdapter: WhatsAppAdapter;
  },
): Promise<CreateTaskFromInboundResult> => {
  const now = input.now ?? (() => new Date());
  const createdAt = now();
  const prompt = resolvePrompt(input.text, input.attachments);

  const task = await deps.manusClient.createTask(prompt, {
    attachments: toManusBase64Attachments(input.attachments),
    taskMode: "adaptive",
    interactiveMode: true,
    hideInTaskList: true,
    agentProfile: input.agentProfile,
  });

  const taskTitle = task.task_title?.trim() || titleFromPrompt(prompt);

  await deps.store.createTaskRecord({
    sessionId: input.sessionId,
    taskId: task.task_id,
    createdByMessageId: input.inboundMessageId,
    taskTitle,
    taskUrl: task.task_url,
    agentProfile: input.agentProfile ?? "manus-1.6",
    createdAt,
    expiresAt: new Date(createdAt.getTime() + TASK_TTL_MS),
  });

  await deps.store.linkInboundMessageToTask({
    messageId: input.inboundMessageId,
    taskId: task.task_id,
    routeReason: input.routeReason ?? DEFAULT_ROUTE_REASON,
  });

  const ackText = buildAckText(taskTitle);
  await deps.whatsappAdapter.sendTextMessage(input.chatId, ackText);

  const ackMessageId = await deps.store.createOutboundMessage({
    sessionId: input.sessionId,
    senderId: input.senderId,
    contentText: ackText,
    contentJson: {
      provider: "whatsapp",
      type: "task_acknowledgement",
      taskId: task.task_id,
      taskTitle,
      taskUrl: task.task_url,
    },
    manusTaskId: task.task_id,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + MESSAGE_TTL_MS),
  });

  return {
    taskId: task.task_id,
    taskTitle,
    taskUrl: task.task_url,
    ackMessageId,
    ackText,
  };
};

export const taskCreationConstants = {
  DEFAULT_PROMPT_FOR_MEDIA,
  DEFAULT_PROMPT_FOR_EMPTY_MESSAGE,
  DEFAULT_ROUTE_REASON,
};
