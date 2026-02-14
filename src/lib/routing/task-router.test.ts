import { describe, expect, it, vi } from "vitest";

import {
  JsonLlmTaskRouterClassifier,
  TaskRouter,
  taskRouterConstants,
  type ActiveTaskForRouting,
  type TaskRouterClassifier,
  type TaskRouterStore,
} from "./task-router";

const activeTasks: ActiveTaskForRouting[] = [
  {
    taskId: "task-a",
    taskTitle: "Find flights",
    originalPrompt: "Find flights to NYC",
    status: "running",
    lastMessage: "Searching options",
    stopReason: null,
  },
  {
    taskId: "task-b",
    taskTitle: "Build report",
    originalPrompt: "Build monthly report",
    status: "pending",
    lastMessage: null,
    stopReason: null,
  },
];

const createDeps = (): { classifier: TaskRouterClassifier; store: TaskRouterStore } => {
  const classifier: TaskRouterClassifier = {
    classify: vi.fn(),
  };

  const store: TaskRouterStore = {
    persistRouteDecision: vi.fn(),
  };

  return { classifier, store };
};

describe("TaskRouter", () => {
  it("returns new when there are no active tasks without calling classifier", async () => {
    const { classifier, store } = createDeps();
    const router = new TaskRouter(classifier, store);

    const result = await router.route({
      messageId: "message-1",
      message: "new request",
      activeTasks: [],
    });

    expect(result).toEqual({
      action: "new",
      reason: taskRouterConstants.NO_ACTIVE_TASKS_REASON,
    });

    expect(vi.mocked(classifier.classify)).not.toHaveBeenCalled();
    expect(vi.mocked(store.persistRouteDecision)).toHaveBeenCalledWith({
      messageId: "message-1",
      action: "new",
      reason: taskRouterConstants.NO_ACTIVE_TASKS_REASON,
      taskId: null,
    });
  });

  it("auto-continues single waiting_user ask task", async () => {
    const { classifier, store } = createDeps();
    const router = new TaskRouter(classifier, store);

    const result = await router.route({
      messageId: "message-2",
      message: "yes choose option 2",
      activeTasks: [
        {
          taskId: "task-ask",
          taskTitle: "Restaurant booking",
          originalPrompt: "Book a restaurant",
          status: "waiting_user",
          lastMessage: "Which option do you want?",
          stopReason: "ask",
        },
      ],
    });

    expect(result).toEqual({
      action: "continue",
      taskId: "task-ask",
      reason: taskRouterConstants.SINGLE_WAITING_ASK_REASON,
    });

    expect(vi.mocked(classifier.classify)).not.toHaveBeenCalled();
    expect(vi.mocked(store.persistRouteDecision)).toHaveBeenCalledWith({
      messageId: "message-2",
      action: "continue",
      reason: taskRouterConstants.SINGLE_WAITING_ASK_REASON,
      taskId: "task-ask",
    });
  });

  it("calls classifier when multiple active tasks exist", async () => {
    const { classifier, store } = createDeps();
    vi.mocked(classifier.classify).mockResolvedValue({
      action: "continue",
      taskId: "task-b",
      reason: "message references report updates",
    });

    const router = new TaskRouter(classifier, store);
    const result = await router.route({
      messageId: "message-3",
      message: "use last month's chart style",
      activeTasks,
    });

    expect(vi.mocked(classifier.classify)).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      action: "continue",
      taskId: "task-b",
      reason: "message references report updates",
    });
  });

  it("rejects classifier continue decision for unknown task id", async () => {
    const { classifier } = createDeps();
    vi.mocked(classifier.classify).mockResolvedValue({
      action: "continue",
      taskId: "missing-task",
      reason: "model picked an unknown id",
    });

    const router = new TaskRouter(classifier);
    const result = await router.route({
      message: "hi",
      activeTasks,
    });

    expect(result).toEqual({
      action: "new",
      reason: "classifier_rejected_unknown_task:missing-task",
    });
  });
});

describe("JsonLlmTaskRouterClassifier", () => {
  it("parses direct JSON response", async () => {
    const llmClient = {
      complete: vi
        .fn()
        .mockResolvedValue('{"action":"continue","task_id":"task-a","reason":"same request"}'),
    };

    const classifier = new JsonLlmTaskRouterClassifier(llmClient);
    const result = await classifier.classify({
      message: "continue it",
      activeTasks,
    });

    expect(result).toEqual({
      action: "continue",
      taskId: "task-a",
      reason: "same request",
    });
  });

  it("extracts JSON object from wrapped markdown response", async () => {
    const llmClient = {
      complete: vi.fn().mockResolvedValue('```json\n{"action":"new","reason":"new request"}\n```'),
    };

    const classifier = new JsonLlmTaskRouterClassifier(llmClient);
    const result = await classifier.classify({
      message: "new item",
      activeTasks,
    });

    expect(result).toEqual({
      action: "new",
      reason: "new request",
    });
  });

  it("falls back to new when JSON is invalid", async () => {
    const llmClient = {
      complete: vi.fn().mockResolvedValue("I think this is task-b"),
    };

    const classifier = new JsonLlmTaskRouterClassifier(llmClient);
    const result = await classifier.classify({
      message: "unknown",
      activeTasks,
    });

    expect(result).toEqual({
      action: "new",
      reason: "classifier_parse_fallback_new",
    });
  });
});
