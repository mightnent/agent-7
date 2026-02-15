import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { DEFAULT_WORKSPACE_ID, workspaceSettings } from "@/db/schema";
import { decryptSetting, encryptSetting } from "@/lib/crypto/settings-cipher";

import {
  getSettingDefinition,
  getSettingDefinitionsByCategory,
  type SettingsCategory,
} from "./settings-catalog";

export interface SettingsService {
  get(workspaceId: string, category: string, key: string): Promise<string | null>;
  getCategory(workspaceId: string, category: SettingsCategory): Promise<Record<string, string>>;
  set(workspaceId: string, category: string, key: string, value: string): Promise<void>;
  delete(workspaceId: string, category: string, key: string): Promise<void>;
}

const toPlaintext = (row: {
  value: string | null;
  encryptedValue: string | null;
  isSensitive: boolean;
}): string | null => {
  if (!row.isSensitive) {
    return row.value;
  }

  if (!row.encryptedValue) {
    return null;
  }

  return decryptSetting(Buffer.from(row.encryptedValue, "base64"));
};

class DrizzleSettingsService implements SettingsService {
  async get(workspaceId: string, category: string, key: string): Promise<string | null> {
    const definition = getSettingDefinition(category, key);
    const envFallback = definition ? process.env[definition.envVar] ?? null : null;

    const [row] = await db
      .select({
        value: workspaceSettings.value,
        encryptedValue: workspaceSettings.encryptedValue,
        isSensitive: workspaceSettings.isSensitive,
      })
      .from(workspaceSettings)
      .where(
        and(
          eq(workspaceSettings.workspaceId, workspaceId),
          eq(workspaceSettings.category, category),
          eq(workspaceSettings.key, key),
        ),
      )
      .limit(1);

    if (!row) {
      return envFallback;
    }

    return toPlaintext(row) ?? envFallback;
  }

  async getCategory(workspaceId: string, category: SettingsCategory): Promise<Record<string, string>> {
    const definitions = getSettingDefinitionsByCategory(category);
    const values: Record<string, string> = {};

    for (const definition of definitions) {
      const value = await this.get(workspaceId, definition.category, definition.key);
      if (value !== null) {
        values[definition.envVar] = value;
      }
    }

    return values;
  }

  async set(workspaceId: string, category: string, key: string, value: string): Promise<void> {
    const definition = getSettingDefinition(category, key);
    const isSensitive = definition?.sensitive ?? false;

    await db
      .insert(workspaceSettings)
      .values({
        workspaceId,
        category,
        key,
        value: isSensitive ? null : value,
        encryptedValue: isSensitive ? encryptSetting(value).toString("base64") : null,
        isSensitive,
        keyVersion: 1,
      })
      .onConflictDoUpdate({
        target: [workspaceSettings.workspaceId, workspaceSettings.category, workspaceSettings.key],
        set: {
          value: isSensitive ? null : value,
          encryptedValue: isSensitive ? encryptSetting(value).toString("base64") : null,
          isSensitive,
          keyVersion: 1,
          updatedAt: new Date(),
        },
      });
  }

  async delete(workspaceId: string, category: string, key: string): Promise<void> {
    await db
      .delete(workspaceSettings)
      .where(
        and(
          eq(workspaceSettings.workspaceId, workspaceId),
          eq(workspaceSettings.category, category),
          eq(workspaceSettings.key, key),
        ),
      );
  }
}

export const settingsService: SettingsService = new DrizzleSettingsService();

export const getDefaultWorkspaceSetting = async (
  category: string,
  key: string,
): Promise<string | null> => {
  return settingsService.get(DEFAULT_WORKSPACE_ID, category, key);
};
