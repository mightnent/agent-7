import type { WhatsAppAdapter } from "@/lib/channel/whatsapp-adapter";
import type { WhatsAppMediaAttachment } from "@/lib/channel/whatsapp-types";
import type { ConnectorResolver } from "@/lib/connectors/resolver";
import { ManusApiError } from "@/lib/manus/client";
import type { ManusClient } from "@/lib/manus/client";
import { toManusBase64Attachments } from "@/lib/manus/client";
import { detectExplicitMemories } from "@/lib/memory/explicit";
import { getMemoriesForLocalResponse } from "@/lib/memory/retrieval";
import type { AgentMemoryStore } from "@/lib/memory/store";
import type { ActiveTaskQueryStore } from "@/lib/routing/task-router.store";
import type { ResponseIntent, TaskRouter } from "@/lib/routing/task-router";
import type { PersonalityMessageRenderer } from "@/lib/orchestration/personality";
import type { LocalResponder } from "@/lib/orchestration/local-responder";

import type { TaskCreationStore } from "./task-creation.store";
import { createTaskFromInboundMessage, ensureManusProjectId, type ManusProjectSettingsStore } from "./task-creation";

const DEFAULT_ROUTER_MESSAGE_FOR_MEDIA = "[User sent media attachment]";
const DEFAULT_ROUTER_MESSAGE_FOR_EMPTY = "[User sent an empty message]";
const DEFAULT_PROMPT_FOR_MEDIA = "Please help with the attached media from the user.";
const DEFAULT_PROMPT_FOR_EMPTY = "User sent an empty message. Ask for clarification and help further.";
const CONTINUE_TASK_NOT_FOUND_FALLBACK_REASON = "continue_task_not_found_fallback_new";
const RESPOND_ESCALATE_REASON = "respond_escalated_to_new_task";
const OUTBOUND_MESSAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EXPLICIT_MEMORY_LOCAL_REASON = "explicit_memory_local";

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
    }
  | {
      action: "respond";
      taskId: string;
      reason: string;
      responseIntent: ResponseIntent;
      responseText: string;
      outboundMessageId: string;
    };

export interface InboundDispatchDeps {
  activeTaskStore: ActiveTaskQueryStore;
  router: TaskRouter;
  connectorResolver: ConnectorResolver;
  manusClient: ManusClient;
  taskStateStore: TaskStateStore;
  whatsappAdapter: WhatsAppAdapter;
  taskCreationStore: TaskCreationStore;
  projectSettingsStore?: ManusProjectSettingsStore;
  personalityRenderer?: PersonalityMessageRenderer;
  memoryStore?: AgentMemoryStore;
  localResponder?: LocalResponder;
}

const persistExplicitMemory = async (
  memoryStore: AgentMemoryStore,
  explicitCandidate: {
    category: "preference" | "fact" | "decision" | "task_outcome" | "correction";
    content: string;
    conflictHints: string[];
  },
  inboundMessageId: string,
  now: Date,
): Promise<void> => {
  const insertedId = await memoryStore.insertMemory({
    category: explicitCandidate.category,
    content: explicitCandidate.content,
    sourceType: "explicit",
    sourceTaskId: null,
    sourceMessageId: inboundMessageId,
    confidence: 1,
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: null,
  });
  const activeInCategory = await memoryStore.listActive({
    categories: [explicitCandidate.category],
    limit: 20,
  });
  const toSupersede = activeInCategory
    .filter((memory) => memory.id !== insertedId)
    .filter((memory) =>
      explicitCandidate.conflictHints.some((hint) => memory.content.toLowerCase().includes(hint.toLowerCase())),
    );
  if (toSupersede.length > 0) {
    await memoryStore.supersedeMemories(
      toSupersede.map((memory) => memory.id),
      insertedId,
      now,
    );
  }
};

const persistExplicitMemories = async (
  memoryStore: AgentMemoryStore,
  candidates: Array<{
    category: "preference" | "fact" | "decision" | "task_outcome" | "correction";
    content: string;
    conflictHints: string[];
  }>,
  inboundMessageId: string,
  now: Date,
): Promise<number> => {
  let inserted = 0;
  for (const candidate of candidates) {
    await persistExplicitMemory(memoryStore, candidate, inboundMessageId, now);
    inserted += 1;
  }
  return inserted;
};

export const dispatchInboundMessage = async (
  input: InboundDispatchInput,
  deps: InboundDispatchDeps,
): Promise<InboundDispatchResult> => {
  const now = input.now ?? (() => new Date());
  const activeTasks = await deps.activeTaskStore.listActiveTasks(input.sessionId);
  const routingMessage = resolveRouterMessage(input.text, input.attachments);
  const explicitCandidates = input.text?.trim() ? detectExplicitMemories(input.text) : [];

  if (deps.memoryStore && explicitCandidates.length > 0 && input.attachments.length === 0) {
    const responseNow = now();
    const inserted = await persistExplicitMemories(deps.memoryStore, explicitCandidates, input.inboundMessageId, responseNow);
    const responseText =
      inserted > 1 ? `Noted — I saved ${inserted} memory items.` : "Noted — I saved that to memory.";
    await deps.whatsappAdapter.sendTextMessage(input.chatId, responseText);
    const outboundMessageId = await deps.taskCreationStore.createOutboundMessage({
      sessionId: input.sessionId,
      senderId: input.senderId,
      contentText: responseText,
      contentJson: {
        provider: "whatsapp",
        type: "local_response",
        responseIntent: "memory_write",
      },
      manusTaskId: null,
      createdAt: responseNow,
      expiresAt: new Date(responseNow.getTime() + OUTBOUND_MESSAGE_TTL_MS),
    });

    return {
      action: "respond",
      taskId: "",
      reason: EXPLICIT_MEMORY_LOCAL_REASON,
      responseIntent: "memory_write",
      responseText,
      outboundMessageId,
    };
  }

  const routingMemories = deps.memoryStore
    ? await deps.memoryStore.listActive({ minConfidence: 0.5, limit: 6 })
    : [];
  const memorySummary = routingMemories.map((memory) => memory.content).join("; ");
  const connectorResolution = await deps.connectorResolver.resolve({
    sessionId: input.sessionId,
    message: routingMessage,
  });
  const connectors = connectorResolution.connectorUids;

  const decision = await deps.router.route({
    messageId: input.inboundMessageId,
    message: routingMessage,
    activeTasks,
    memorySummary,
  });
  if (decision.action === "continue") {
    if (deps.memoryStore && explicitCandidates.length > 0) {
      await persistExplicitMemories(deps.memoryStore, explicitCandidates, input.inboundMessageId, now());
    }

    const prompt = resolvePrompt(input.text, input.attachments);
    const projectId = await ensureManusProjectId(deps.manusClient, deps.projectSettingsStore);
    try {
      await deps.manusClient.continueTask(decision.taskId, prompt, {
        taskMode: "adaptive",
        interactiveMode: true,
        hideInTaskList: true,
        agentProfile: input.agentProfile,
        attachments: toManusBase64Attachments(input.attachments),
        connectors,
        projectId,
      });
    } catch (error) {
      const isMissingTask =
        error instanceof ManusApiError &&
        error.status === 404 &&
        (error.body?.toLowerCase().includes("task not found") ?? false);

      if (!isMissingTask) {
        throw error;
      }

      const created = await createTaskFromInboundMessage(
        {
          sessionId: input.sessionId,
          inboundMessageId: input.inboundMessageId,
          chatId: input.chatId,
          text: input.text,
          attachments: input.attachments,
          senderId: input.senderId,
          routeReason: CONTINUE_TASK_NOT_FOUND_FALLBACK_REASON,
          connectors,
          connectorResolution: {
            reason: connectorResolution.reason,
            source: connectorResolution.source,
            confidence: connectorResolution.confidence,
          },
          agentProfile: input.agentProfile,
          now,
        },
        {
          manusClient: deps.manusClient,
          whatsappAdapter: deps.whatsappAdapter,
          store: deps.taskCreationStore,
          projectSettingsStore: deps.projectSettingsStore,
          personalityRenderer: deps.personalityRenderer,
          memoryStore: deps.memoryStore,
        },
      );

      return {
        action: "new",
        taskId: created.taskId,
        reason: CONTINUE_TASK_NOT_FOUND_FALLBACK_REASON,
        ackMessageId: created.ackMessageId,
        ackText: created.ackText,
      };
    }

    await deps.taskStateStore.markTaskRunning(decision.taskId, now());

    return {
      action: "continue",
      taskId: decision.taskId,
      reason: decision.reason,
    };
  }

  if (decision.action === "respond") {
    const responseNow = now();
    const message = input.text?.trim() ?? "";
    const memories =
      deps.memoryStore && message
        ? await getMemoriesForLocalResponse(deps.memoryStore, message, responseNow)
        : [];

    if (deps.memoryStore && explicitCandidates.length > 0) {
      await persistExplicitMemories(deps.memoryStore, explicitCandidates, input.inboundMessageId, responseNow);
    }

    const response = await deps.localResponder?.respond({
      message: routingMessage,
      intent: decision.responseIntent,
      memories,
    });

    if (response?.escalate) {
      const created = await createTaskFromInboundMessage(
        {
          sessionId: input.sessionId,
          inboundMessageId: input.inboundMessageId,
          chatId: input.chatId,
          text: input.text,
          attachments: input.attachments,
          senderId: input.senderId,
          routeReason: RESPOND_ESCALATE_REASON,
          connectors,
          connectorResolution: {
            reason: connectorResolution.reason,
            source: connectorResolution.source,
            confidence: connectorResolution.confidence,
          },
          agentProfile: input.agentProfile,
          now,
        },
        {
          manusClient: deps.manusClient,
          whatsappAdapter: deps.whatsappAdapter,
          store: deps.taskCreationStore,
          projectSettingsStore: deps.projectSettingsStore,
          personalityRenderer: deps.personalityRenderer,
          memoryStore: deps.memoryStore,
        },
      );

      return {
        action: "new",
        taskId: created.taskId,
        reason: RESPOND_ESCALATE_REASON,
        ackMessageId: created.ackMessageId,
        ackText: created.ackText,
      };
    }

    const responseText = response?.text?.trim() || "Understood.";
    await deps.whatsappAdapter.sendTextMessage(input.chatId, responseText);

    const outboundMessageId = await deps.taskCreationStore.createOutboundMessage({
      sessionId: input.sessionId,
      senderId: input.senderId,
      contentText: responseText,
      contentJson: {
        provider: "whatsapp",
        type: "local_response",
        responseIntent: decision.responseIntent,
      },
      manusTaskId: null,
      createdAt: responseNow,
      expiresAt: new Date(responseNow.getTime() + OUTBOUND_MESSAGE_TTL_MS),
    });

    return {
      action: "respond",
      taskId: "",
      reason: decision.reason,
      responseIntent: decision.responseIntent,
      responseText,
      outboundMessageId,
    };
  }

  if (deps.memoryStore && explicitCandidates.length > 0) {
    await persistExplicitMemories(deps.memoryStore, explicitCandidates, input.inboundMessageId, now());
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
      connectors,
      connectorResolution: {
        reason: connectorResolution.reason,
        source: connectorResolution.source,
        confidence: connectorResolution.confidence,
      },
      agentProfile: input.agentProfile,
      now,
    },
    {
      manusClient: deps.manusClient,
      whatsappAdapter: deps.whatsappAdapter,
      store: deps.taskCreationStore,
      projectSettingsStore: deps.projectSettingsStore,
      personalityRenderer: deps.personalityRenderer,
      memoryStore: deps.memoryStore,
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

export const inboundDispatchConstants = {
  CONTINUE_TASK_NOT_FOUND_FALLBACK_REASON,
  RESPOND_ESCALATE_REASON,
  EXPLICIT_MEMORY_LOCAL_REASON,
};
