import { randomUUID } from "node:crypto";

import { getEnv } from "@/lib/env";

export interface ManusFileIdAttachment {
  filename: string;
  file_id: string;
}

export interface ManusUrlAttachment {
  filename: string;
  url: string;
  mimeType?: string;
}

export interface ManusBase64Attachment {
  filename: string;
  fileData: string;
}

export type ManusAttachment = ManusFileIdAttachment | ManusUrlAttachment | ManusBase64Attachment;

export interface ManusCreateTaskRequest {
  prompt: string;
  attachments?: ManusAttachment[];
  taskMode?: "chat" | "adaptive" | "agent";
  connectors?: string[];
  hideInTaskList?: boolean;
  createShareableLink?: boolean;
  taskId?: string;
  agentProfile?: "manus-1.6" | "manus-1.6-lite" | "manus-1.6-max";
  locale?: string;
  projectId?: string;
  interactiveMode?: boolean;
}

export interface ManusCreateTaskResponse {
  task_id: string;
  task_title: string;
  task_url: string;
  share_url?: string;
}

export interface ManusTaskOutputContent {
  type: "output_text" | "output_file";
  text?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
}

export interface ManusTaskMessage {
  id: string;
  status: string;
  role: "user" | "assistant";
  type: string;
  content: ManusTaskOutputContent[];
}

export interface ManusTaskResponse {
  id: string;
  object: string;
  created_at: number;
  updated_at: number;
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
  incomplete_details?: string;
  instructions?: string;
  model?: string;
  metadata?: {
    task_title?: string;
    task_url?: string;
    [key: string]: string | undefined;
  };
  output?: ManusTaskMessage[];
  locale?: string;
  credit_usage?: number;
}

export interface ManusClientConfig {
  apiKey: string;
  baseUrl: string;
  defaultAgentProfile?: "manus-1.6" | "manus-1.6-lite" | "manus-1.6-max";
  defaultInteractiveMode?: boolean;
  defaultHideInTaskList?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  baseRetryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export interface InboundAttachmentLike {
  fileName: string;
  mimetype: string;
  buffer: Buffer;
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const shouldRetryStatus = (status: number): boolean => status >= 500 || status === 429;

export class ManusApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "ManusApiError";
  }
}

export class ManusClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly defaultAgentProfile: "manus-1.6" | "manus-1.6-lite" | "manus-1.6-max";
  private readonly defaultInteractiveMode: boolean;
  private readonly defaultHideInTaskList: boolean;

  constructor(private readonly config: ManusClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.baseRetryDelayMs = config.baseRetryDelayMs ?? 300;
    this.defaultAgentProfile = config.defaultAgentProfile ?? "manus-1.6";
    this.defaultInteractiveMode = config.defaultInteractiveMode ?? true;
    this.defaultHideInTaskList = config.defaultHideInTaskList ?? true;
  }

  async createTask(prompt: string, options: Omit<ManusCreateTaskRequest, "prompt"> = {}): Promise<ManusCreateTaskResponse> {
    const payload: ManusCreateTaskRequest = {
      prompt,
      taskMode: options.taskMode ?? "adaptive",
      agentProfile: options.agentProfile ?? this.defaultAgentProfile,
      interactiveMode: options.interactiveMode ?? this.defaultInteractiveMode,
      hideInTaskList: options.hideInTaskList ?? this.defaultHideInTaskList,
      attachments: options.attachments,
      connectors: options.connectors,
      createShareableLink: options.createShareableLink,
      taskId: options.taskId,
      locale: options.locale,
      projectId: options.projectId,
    };

    return this.requestJson<ManusCreateTaskResponse>("/v1/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async continueTask(
    taskId: string,
    prompt: string,
    options: Omit<ManusCreateTaskRequest, "prompt" | "taskId"> = {},
  ): Promise<ManusCreateTaskResponse> {
    return this.createTask(prompt, {
      ...options,
      taskId,
    });
  }

  async getTask(taskId: string, options: { convert?: boolean } = {}): Promise<ManusTaskResponse> {
    const params = new URLSearchParams();
    if (typeof options.convert === "boolean") {
      params.set("convert", String(options.convert));
    }

    const query = params.toString();
    const suffix = query ? `?${query}` : "";

    return this.requestJson<ManusTaskResponse>(`/v1/tasks/${encodeURIComponent(taskId)}${suffix}`, {
      method: "GET",
    });
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const url = new URL(path, this.config.baseUrl).toString();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const headers = new Headers(init.headers ?? {});
        headers.set("Content-Type", "application/json");
        headers.set("API_KEY", this.config.apiKey);
        headers.set("x-request-id", randomUUID());

        const response = await this.fetchImpl(url, {
          ...init,
          headers,
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text();
          const error = new ManusApiError(`Manus request failed with status ${response.status}`, response.status, body);

          if (!shouldRetryStatus(response.status) || attempt === this.maxAttempts) {
            throw error;
          }

          lastError = error;
          await sleep(this.baseRetryDelayMs * 2 ** (attempt - 1));
          continue;
        }

        return (await response.json()) as T;
      } catch (error) {
        const typedError = error instanceof Error ? error : new Error("Unknown Manus request error");
        lastError = typedError;

        if (attempt === this.maxAttempts) {
          break;
        }

        await sleep(this.baseRetryDelayMs * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new Error("Unknown Manus request failure");
  }
}

export const toManusBase64Attachments = (attachments: InboundAttachmentLike[]): ManusBase64Attachment[] => {
  return attachments.map((attachment) => ({
    filename: attachment.fileName,
    fileData: `data:${attachment.mimetype};base64,${attachment.buffer.toString("base64")}`,
  }));
};

export const createManusClientFromEnv = (): ManusClient => {
  const env = getEnv();

  return new ManusClient({
    apiKey: env.MANUS_API_KEY,
    baseUrl: env.MANUS_BASE_URL,
    defaultAgentProfile: env.MANUS_AGENT_PROFILE,
    defaultInteractiveMode: true,
    defaultHideInTaskList: true,
  });
};
