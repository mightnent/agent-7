import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";
import type { WhatsAppMediaAttachment } from "@/lib/channel/whatsapp-types";
import type { ManusClient } from "@/lib/manus/client";
import { toManusBase64Attachments } from "@/lib/manus/client";
import type { ActiveTaskQueryStore } from "@/lib/routing/task-router.store";
import type { TaskRouter } from "@/lib/routing/task-router";

import type { TaskCreationStore } from "./task-creation.store";
import { createTaskFromInboundMessage } from "./task-creation";

const DEFAULT_ROUTER_MESSAGE_FOR_MEDIA = "[User sent media attachment]";
const DEFAULT_ROUTER_MESSAGE_FOR_EMPTY = "[User sent an empty message]";
const DEFAULT_PROMPT_FOR_MEDIA = "Please help with the attached media from the user.";
const DEFAULT_PROMPT_FOR_EMPTY = "User sent an empty message. Ask for clarification and help further.";

const resolvePrompt = (text: string | null, attachments: WhatsAppMediaAttachment[]): string => {
  const trimmed = text?.trim();
  if (trimmed) {
    return trimmed;
  }

  if (attachments.length > 0) {
    return DEFAULT_PROMPT_FOR_MEDIA;
  }

  return DEFAULT_PROMPT_FOR_EMPTY;
};

const resolveRouterMessage = (text: string | null, attachments: WhatsAppMediaAttachment[]): string => {
  const trimmed = text?.trim();
  if (trimmed) {
    return trimmed;
  }

  if (attachments.length > 0) {
    return DEFAULT_ROUTER_MESSAGE_FOR_MEDIA;
  }

  return DEFAULT_ROUTER_MESSAGE_FOR_EMPTY;
};

export interface TaskStateStore {
  markTaskRunning(taskId: string, updatedAt: Date): Promise<void>;
}

export interface InboundDispatchInput {
  sessionId: string;
  inboundMessageId: string;
  chatId: string;
  senderId: string;
  text: string | null;
  attachments: WhatsAppMediaAttachment[];
  agentProfile?: "manus-1.6" | "manus-1.6-lite" | "manus-1.6-max";
  now?: () => Date;
}

export type InboundDispatchResult =
  | {
      action: "continue";
      taskId: string;
      reason: string;
    }
  | {
      action: "new";
      taskId: string;
      reason: string;
      ackMessageId: string;
      ackText: string;
    };

export interface InboundDispatchDeps {
  activeTaskStore: ActiveTaskQueryStore;
  router: TaskRouter;
  manusClient: ManusClient;
  taskStateStore: TaskStateStore;
  whatsappAdapter: WhatsAppAdapter;
  taskCreationStore: TaskCreationStore;
}

export const dispatchInboundMessage = async (
  input: InboundDispatchInput,
  deps: InboundDispatchDeps,
): Promise<InboundDispatchResult> => {
  const now = input.now ?? (() => new Date());
  const activeTasks = await deps.activeTaskStore.listActiveTasks(input.sessionId);
  const routingMessage = resolveRouterMessage(input.text, input.attachments);

  const decision = await deps.router.route({
    messageId: input.inboundMessageId,
    message: routingMessage,
    activeTasks,
  });

  if (decision.action === "continue") {
    const prompt = resolvePrompt(input.text, input.attachments);
    await deps.manusClient.continueTask(decision.taskId, prompt, {
      taskMode: "adaptive",
      interactiveMode: true,
      hideInTaskList: true,
      agentProfile: input.agentProfile,
      attachments: toManusBase64Attachments(input.attachments),
    });

    await deps.taskStateStore.markTaskRunning(decision.taskId, now());

    return {
      action: "continue",
      taskId: decision.taskId,
      reason: decision.reason,
    };
  }

  const created = await createTaskFromInboundMessage(
    {
      sessionId: input.sessionId,
      inboundMessageId: input.inboundMessageId,
      chatId: input.chatId,
      text: input.text,
      attachments: input.attachments,
      senderId: input.senderId,
      routeReason: decision.reason,
      agentProfile: input.agentProfile,
      now,
    },
    {
      manusClient: deps.manusClient,
      whatsappAdapter: deps.whatsappAdapter,
      store: deps.taskCreationStore,
    },
  );

  return {
    action: "new",
    taskId: created.taskId,
    reason: decision.reason,
    ackMessageId: created.ackMessageId,
    ackText: created.ackText,
  };
};
