export type ActiveTaskStatus = "pending" | "running" | "waiting_user";

export interface ActiveTaskForRouting {
  taskId: string;
  taskTitle: string;
  originalPrompt: string;
  status: ActiveTaskStatus;
  lastMessage: string | null;
  stopReason?: "finish" | "ask" | null;
}

export interface TaskRouterClassifierInput {
  message: string;
  activeTasks: ActiveTaskForRouting[];
}

export type TaskRouterDecision =
  | {
      action: "continue";
      taskId: string;
      reason: string;
    }
  | {
      action: "new";
      reason: string;
    };

export interface TaskRouterClassifier {
  classify(input: TaskRouterClassifierInput): Promise<TaskRouterDecision>;
}

export interface TaskRouterStore {
  persistRouteDecision(input: {
    messageId: string;
    action: TaskRouterDecision["action"];
    reason: string;
    taskId: string | null;
  }): Promise<void>;
}

export interface TaskRouterInput extends TaskRouterClassifierInput {
  messageId?: string;
}

const SINGLE_WAITING_ASK_REASON = "single_waiting_user_task";
const NO_ACTIVE_TASKS_REASON = "no_active_tasks";
const CLASSIFIER_ERROR_FALLBACK_REASON = "classifier_error_fallback_new";

const validateClassifierDecision = (
  decision: TaskRouterDecision,
  activeTasks: ActiveTaskForRouting[],
): TaskRouterDecision => {
  if (decision.action === "new") {
    return decision;
  }

  const exists = activeTasks.some((task) => task.taskId === decision.taskId);
  if (exists) {
    return decision;
  }

  return {
    action: "new",
    reason: `classifier_rejected_unknown_task:${decision.taskId}`,
  };
};

export class TaskRouter {
  constructor(
    private readonly classifier: TaskRouterClassifier,
    private readonly store?: TaskRouterStore,
  ) {}

  async route(input: TaskRouterInput): Promise<TaskRouterDecision> {
    if (input.activeTasks.length === 0) {
      const decision: TaskRouterDecision = {
        action: "new",
        reason: NO_ACTIVE_TASKS_REASON,
      };
      await this.persistIfNeeded(input.messageId, decision);
      return decision;
    }

    if (
      input.activeTasks.length === 1 &&
      input.activeTasks[0]?.status === "waiting_user" &&
      input.activeTasks[0].stopReason === "ask"
    ) {
      const decision: TaskRouterDecision = {
        action: "continue",
        taskId: input.activeTasks[0].taskId,
        reason: SINGLE_WAITING_ASK_REASON,
      };
      await this.persistIfNeeded(input.messageId, decision);
      return decision;
    }

    let classified: TaskRouterDecision;
    try {
      classified = await this.classifier.classify({
        message: input.message,
        activeTasks: input.activeTasks,
      });
    } catch {
      const decision: TaskRouterDecision = {
        action: "new",
        reason: CLASSIFIER_ERROR_FALLBACK_REASON,
      };
      await this.persistIfNeeded(input.messageId, decision);
      return decision;
    }

    const decision = validateClassifierDecision(classified, input.activeTasks);
    await this.persistIfNeeded(input.messageId, decision);
    return decision;
  }

  private async persistIfNeeded(messageId: string | undefined, decision: TaskRouterDecision): Promise<void> {
    if (!messageId || !this.store) {
      return;
    }

    await this.store.persistRouteDecision({
      messageId,
      action: decision.action,
      reason: decision.reason,
      taskId: decision.action === "continue" ? decision.taskId : null,
    });
  }
}

export interface LlmCompletionClient {
  complete(input: { system: string; prompt: string }): Promise<string>;
}

const classifierSystemPrompt = [
  "You are a message router.",
  "Given currently active tasks and a new user message, decide if the message should continue an existing task or start a new one.",
  "Respond with JSON only.",
  'Valid JSON schema: { "action": "continue", "task_id": "<id>", "reason": "..." } OR { "action": "new", "reason": "..." }',
].join(" ");

const parseDecisionFromJson = (text: string): TaskRouterDecision | null => {
  const tryParse = (candidate: string): TaskRouterDecision | null => {
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>;
      const action = value.action;
      const reason = typeof value.reason === "string" ? value.reason : "classifier_no_reason";

      if (action === "new") {
        return {
          action: "new",
          reason,
        };
      }

      if (action === "continue") {
        const taskIdValue = value.task_id ?? value.taskId;
        if (typeof taskIdValue === "string" && taskIdValue.trim().length > 0) {
          return {
            action: "continue",
            taskId: taskIdValue,
            reason,
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  };

  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct) {
    return direct;
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    return null;
  }

  return tryParse(objectMatch[0]);
};

const buildClassifierPrompt = (input: TaskRouterClassifierInput): string => {
  const tasks = input.activeTasks
    .map((task) => ({
      task_id: task.taskId,
      task_title: task.taskTitle,
      original_prompt: task.originalPrompt,
      status: task.status,
      last_message: task.lastMessage,
    }))
    .slice(0, 20);

  return JSON.stringify(
    {
      message: input.message,
      active_tasks: tasks,
    },
    null,
    2,
  );
};

export class JsonLlmTaskRouterClassifier implements TaskRouterClassifier {
  constructor(private readonly llmClient: LlmCompletionClient) {}

  async classify(input: TaskRouterClassifierInput): Promise<TaskRouterDecision> {
    const response = await this.llmClient.complete({
      system: classifierSystemPrompt,
      prompt: buildClassifierPrompt(input),
    });

    const parsed = parseDecisionFromJson(response);
    if (parsed) {
      return parsed;
    }

    return {
      action: "new",
      reason: "classifier_parse_fallback_new",
    };
  }
}

export const taskRouterConstants = {
  SINGLE_WAITING_ASK_REASON,
  NO_ACTIVE_TASKS_REASON,
  CLASSIFIER_ERROR_FALLBACK_REASON,
};
