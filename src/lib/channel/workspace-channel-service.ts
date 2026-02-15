import * as fs from "node:fs";
import * as path from "node:path";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { DEFAULT_WORKSPACE_ID, workspaceChannels } from "@/db/schema";

import type { BotConfig } from "./bot-config";
import { loadBotConfig } from "./bot-config";

export interface WhatsAppChannelState {
  status: string;
  phoneNumber: string | null;
  displayName: string | null;
  connectedAt: string | null;
}

const DEFAULT_CHANNEL_STATUS: WhatsAppChannelState = {
  status: "disconnected",
  phoneNumber: null,
  displayName: null,
  connectedAt: null,
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: string;
    cause?: { code?: string };
  };

  return candidate.code === "42P01" || candidate.cause?.code === "42P01";
};

const isBotConfig = (value: unknown): value is BotConfig => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.assistantName === "string" &&
    candidate.mainChannel !== null &&
    typeof candidate.mainChannel === "object" &&
    candidate.registeredChats !== null &&
    typeof candidate.registeredChats === "object"
  );
};

const readBotConfigFromDb = async (workspaceId: string): Promise<BotConfig | null> => {
  let row:
    | {
        configJson: unknown;
      }
    | undefined;

  try {
    [row] = await db
      .select({ configJson: workspaceChannels.configJson })
      .from(workspaceChannels)
      .where(and(eq(workspaceChannels.workspaceId, workspaceId), eq(workspaceChannels.channel, "whatsapp")))
      .limit(1);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }

  if (!row || !isBotConfig(row.configJson)) {
    return null;
  }

  return row.configJson;
};

const writeBotConfigFile = (authDir: string, config: BotConfig): void => {
  const configPath = path.join(authDir, "bot-config.json");
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
};

export const loadWorkspaceBotConfig = async (
  workspaceId = DEFAULT_WORKSPACE_ID,
  authDir?: string,
): Promise<BotConfig | null> => {
  try {
    const fromDb = await readBotConfigFromDb(workspaceId);
    if (fromDb) {
      return fromDb;
    }
  } catch {
    // Fall through to filesystem fallback for resilience in OSS mode.
  }

  if (!authDir) {
    return null;
  }

  return loadBotConfig(authDir);
};

export const saveWorkspaceBotConfig = async (
  config: BotConfig,
  options?: { workspaceId?: string; authDir?: string },
): Promise<void> => {
  const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;

  try {
    await db
      .insert(workspaceChannels)
      .values({
        workspaceId,
        channel: "whatsapp",
        configJson: config,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [workspaceChannels.workspaceId, workspaceChannels.channel],
        set: {
          configJson: config,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
  }

  if (options?.authDir) {
    writeBotConfigFile(options.authDir, config);
  }
};

export const updateWhatsAppChannelConnection = async (
  patch: {
    workspaceId?: string;
    status: string;
    phoneNumber?: string | null;
    displayName?: string | null;
    connectedAt?: Date | null;
  },
): Promise<void> => {
  const workspaceId = patch.workspaceId ?? DEFAULT_WORKSPACE_ID;

  try {
    await db
      .insert(workspaceChannels)
      .values({
        workspaceId,
        channel: "whatsapp",
        status: patch.status,
        phoneNumber: patch.phoneNumber ?? null,
        displayName: patch.displayName ?? null,
        connectedAt: patch.connectedAt ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [workspaceChannels.workspaceId, workspaceChannels.channel],
        set: {
          status: patch.status,
          phoneNumber: patch.phoneNumber ?? null,
          displayName: patch.displayName ?? null,
          connectedAt: patch.connectedAt ?? null,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
  }
};

export const getWhatsAppChannelState = async (
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<WhatsAppChannelState> => {
  let row:
    | {
        status: string;
        phoneNumber: string | null;
        displayName: string | null;
        connectedAt: Date | null;
      }
    | undefined;

  try {
    [row] = await db
      .select({
        status: workspaceChannels.status,
        phoneNumber: workspaceChannels.phoneNumber,
        displayName: workspaceChannels.displayName,
        connectedAt: workspaceChannels.connectedAt,
      })
      .from(workspaceChannels)
      .where(and(eq(workspaceChannels.workspaceId, workspaceId), eq(workspaceChannels.channel, "whatsapp")))
      .limit(1);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return DEFAULT_CHANNEL_STATUS;
    }
    throw error;
  }

  if (!row) {
    return DEFAULT_CHANNEL_STATUS;
  }

  return {
    status: row.status,
    phoneNumber: row.phoneNumber,
    displayName: row.displayName,
    connectedAt: row.connectedAt ? row.connectedAt.toISOString() : null,
  };
};
