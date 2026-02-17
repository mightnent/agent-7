import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

import { settingsService } from "@/lib/config/settings-service";
import { getEnv } from "@/lib/env";

export type TunnelStatus = "idle" | "starting" | "running" | "stopped" | "error";
export type TunnelWebhookStatus = "idle" | "registering" | "registered" | "error";

export interface TunnelSnapshot {
  status: TunnelStatus;
  pid: number | null;
  localPort: number;
  publicUrl: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  lastError: string | null;
  lastLog: string | null;
  webhook: {
    status: TunnelWebhookStatus;
    baseUrl: string | null;
    registeredAt: string | null;
    lastError: string | null;
  };
}

interface TunnelRuntimeState {
  process: ChildProcessByStdio<null, Readable, Readable> | null;
  status: TunnelStatus;
  localPort: number;
  publicUrl: string | null;
  startedAt: Date | null;
  stoppedAt: Date | null;
  lastError: string | null;
  lastLog: string | null;
  stdoutBuffer: string;
  stderrBuffer: string;
  webhook: {
    status: TunnelWebhookStatus;
    baseUrl: string | null;
    registeredAt: Date | null;
    lastError: string | null;
  };
}

declare global {
  var __manus_tunnel_manager__: TunnelRuntimeState | undefined;
}

const DEFAULT_LOCAL_PORT = Number.parseInt(process.env.PORT ?? "3000", 10) || 3000;
const TRYCLOUDFLARE_REGEX = /(https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com(?:\/[\w\-.~:/?#[\]@!$&'()*+,;=%]*)?)/;

const getState = (): TunnelRuntimeState => {
  if (!globalThis.__manus_tunnel_manager__) {
    globalThis.__manus_tunnel_manager__ = {
      process: null,
      status: "idle",
      localPort: DEFAULT_LOCAL_PORT,
      publicUrl: null,
      startedAt: null,
      stoppedAt: null,
      lastError: null,
      lastLog: null,
      stdoutBuffer: "",
      stderrBuffer: "",
      webhook: {
        status: "idle",
        baseUrl: null,
        registeredAt: null,
        lastError: null,
      },
    };
  }
  return globalThis.__manus_tunnel_manager__;
};

const toSnapshot = (state: TunnelRuntimeState): TunnelSnapshot => {
  return {
    status: state.status,
    pid: state.process?.pid ?? null,
    localPort: state.localPort,
    publicUrl: state.publicUrl,
    startedAt: state.startedAt?.toISOString() ?? null,
    stoppedAt: state.stoppedAt?.toISOString() ?? null,
    lastError: state.lastError,
    lastLog: state.lastLog,
    webhook: {
      status: state.webhook.status,
      baseUrl: state.webhook.baseUrl,
      registeredAt: state.webhook.registeredAt?.toISOString() ?? null,
      lastError: state.webhook.lastError,
    },
  };
};

const parseTryCloudflareUrl = (line: string): string | null => {
  const match = line.match(TRYCLOUDFLARE_REGEX);
  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed = new URL(match[1]);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const buildWebhookCallbackUrl = (publicUrl: string, secret: string): string => {
  const callback = new URL("/api/manus/webhook", publicUrl);
  callback.searchParams.set("secret", secret);
  return callback.toString();
};

const registerWebhook = async (workspaceId: string, callbackUrl: string): Promise<void> => {
  const env = await getEnv(workspaceId);

  if (!env.MANUS_API_KEY) {
    throw new Error("MANUS_API_KEY is empty; set Manus API key before starting tunnel.");
  }
  if (!env.MANUS_WEBHOOK_SECRET) {
    throw new Error("MANUS_WEBHOOK_SECRET is empty; set Manus webhook secret before starting tunnel.");
  }

  const endpoint = new URL("/v1/webhooks", env.MANUS_BASE_URL).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      API_KEY: env.MANUS_API_KEY,
    },
    body: JSON.stringify({
      webhook: {
        url: callbackUrl,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Manus webhook registration failed (${response.status}): ${body}`);
  }
};

const handleCapturedPublicUrl = async (workspaceId: string, publicUrl: string): Promise<void> => {
  const state = getState();
  const env = await getEnv(workspaceId);

  state.status = "running";
  state.publicUrl = publicUrl;
  state.startedAt ??= new Date();
  state.lastError = null;

  const callbackUrl = buildWebhookCallbackUrl(publicUrl, env.MANUS_WEBHOOK_SECRET);
  const baseUrl = publicUrl;
  state.webhook.status = "registering";
  state.webhook.baseUrl = baseUrl;
  state.webhook.lastError = null;

  try {
    await settingsService.set(workspaceId, "manus", "webhook_url", baseUrl);
    await registerWebhook(workspaceId, callbackUrl);

    state.webhook.status = "registered";
    state.webhook.registeredAt = new Date();
    state.webhook.lastError = null;
  } catch (error) {
    state.webhook.status = "error";
    state.webhook.lastError = error instanceof Error ? error.message : "Unknown webhook registration error";
  }
};

const processLine = (workspaceId: string, line: string): void => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const state = getState();
  state.lastLog = trimmed;

  const publicUrl = parseTryCloudflareUrl(trimmed);
  if (!publicUrl || publicUrl === state.publicUrl) {
    return;
  }

  void handleCapturedPublicUrl(workspaceId, publicUrl);
};

const consumeChunk = (
  workspaceId: string,
  stream: "stdout" | "stderr",
  chunk: Buffer,
): void => {
  const state = getState();
  const key = stream === "stdout" ? "stdoutBuffer" : "stderrBuffer";
  const next = `${state[key]}${chunk.toString("utf8")}`;
  const lines = next.split(/\r?\n/);
  state[key] = lines.pop() ?? "";

  for (const line of lines) {
    processLine(workspaceId, line);
  }
};

const handleStopCleanup = (): void => {
  const state = getState();
  state.process = null;
  state.stdoutBuffer = "";
  state.stderrBuffer = "";
};

const waitForProcessExit = async (
  child: ChildProcessByStdio<null, Readable, Readable>,
  timeoutMs: number,
): Promise<void> => {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve();
    }, timeoutMs);

    const onExit = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve();
    };

    child.on("exit", onExit);
  });
};

export const getTunnelStatus = (): TunnelSnapshot => {
  const state = getState();
  return toSnapshot(state);
};

export const startTunnel = async (
  workspaceId: string,
  options: { localPort?: number } = {},
): Promise<TunnelSnapshot> => {
  const state = getState();

  if (state.process && (state.status === "starting" || state.status === "running")) {
    return toSnapshot(state);
  }

  state.localPort = options.localPort ?? DEFAULT_LOCAL_PORT;
  state.status = "starting";
  state.lastError = null;
  state.stoppedAt = null;
  state.publicUrl = null;
  state.startedAt = null;
  state.stdoutBuffer = "";
  state.stderrBuffer = "";
  state.webhook.status = "idle";
  state.webhook.baseUrl = null;
  state.webhook.lastError = null;
  state.webhook.registeredAt = null;

  try {
    const child = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${state.localPort}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    state.process = child;

    child.stdout.on("data", (chunk: Buffer) => {
      consumeChunk(workspaceId, "stdout", chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      consumeChunk(workspaceId, "stderr", chunk);
    });

    child.on("error", (error) => {
      state.status = "error";
      state.lastError = error instanceof Error ? error.message : "Failed to start cloudflared";
      state.stoppedAt = new Date();
      handleStopCleanup();
    });

    child.on("exit", (code, signal) => {
      const wasRunning = state.status === "running" || state.status === "starting";
      if (wasRunning) {
        if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
          state.status = "stopped";
        } else {
          state.status = "error";
          state.lastError = `Tunnel process exited unexpectedly${code !== null ? ` (code ${code})` : ""}${signal ? ` via ${signal}` : ""}.`;
        }
      }

      state.stoppedAt = new Date();
      handleStopCleanup();
    });
  } catch (error) {
    state.status = "error";
    state.lastError = error instanceof Error ? error.message : "Failed to spawn cloudflared";
    state.stoppedAt = new Date();
    handleStopCleanup();
  }

  return toSnapshot(state);
};

export const stopTunnel = async (workspaceId: string): Promise<TunnelSnapshot> => {
  const state = getState();

  if (state.process) {
    const child = state.process;
    state.status = "stopped";
    state.stoppedAt = new Date();
    child.kill("SIGTERM");
    await waitForProcessExit(child, 2_000);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await waitForProcessExit(child, 1_000);
    }
    handleStopCleanup();
  }

  state.publicUrl = null;
  state.webhook.status = "idle";
  state.webhook.baseUrl = null;
  state.webhook.registeredAt = null;

  try {
    await settingsService.delete(workspaceId, "manus", "webhook_url");
    state.webhook.lastError = null;
  } catch (error) {
    state.webhook.lastError =
      error instanceof Error ? error.message : "Failed clearing MANUS webhook URL setting";
  }

  return toSnapshot(state);
};
