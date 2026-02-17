import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { DEFAULT_WORKSPACE_ID, whatsappAuthKeys } from "@/db/schema";
import { decryptSetting, encryptSetting } from "@/lib/crypto/settings-cipher";

import { proto } from "@whiskeysockets/baileys/WAProto/index.js";
import { BufferJSON } from "@whiskeysockets/baileys/lib/Utils/generics.js";
import { initAuthCreds } from "@whiskeysockets/baileys/lib/Utils/auth-utils.js";
import type { AuthenticationState, SignalDataTypeMap } from "@whiskeysockets/baileys/lib/Types/Auth.js";

interface DbAuthStateOptions {
  workspaceId?: string;
  sessionName?: string;
}

const CREDS_KEY_TYPE = "creds";
const CREDS_KEY_ID = "main";

const serializeAuthValue = (value: unknown): string => {
  return JSON.stringify(value, BufferJSON.replacer);
};

const deserializeAuthValue = <T>(value: string): T => {
  return JSON.parse(value, BufferJSON.reviver) as T;
};

const encryptAuthValue = (value: unknown): string => {
  return encryptSetting(serializeAuthValue(value)).toString("base64");
};

const decryptAuthValue = <T>(encrypted: string): T => {
  try {
    return deserializeAuthValue<T>(decryptSetting(Buffer.from(encrypted, "base64")));
  } catch {
    // Backward compatibility for pre-encryption rows migrated from jsonb->text.
    return deserializeAuthValue<T>(encrypted);
  }
};

export const loadDbAuthState = async (
  options?: DbAuthStateOptions,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {
  const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const sessionName = options?.sessionName ?? "default";

  const [credsRow] = await db
    .select({ encryptedValue: whatsappAuthKeys.encryptedValue })
    .from(whatsappAuthKeys)
    .where(
      and(
        eq(whatsappAuthKeys.workspaceId, workspaceId),
        eq(whatsappAuthKeys.sessionName, sessionName),
        eq(whatsappAuthKeys.keyType, CREDS_KEY_TYPE),
        eq(whatsappAuthKeys.keyId, CREDS_KEY_ID),
      ),
    )
    .limit(1);

  const creds = credsRow
    ? decryptAuthValue<AuthenticationState["creds"]>(credsRow.encryptedValue)
    : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[],
      ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
        if (ids.length === 0) {
          return {} as { [id: string]: SignalDataTypeMap[T] };
        }

        const rows = await db
          .select({
            keyId: whatsappAuthKeys.keyId,
            encryptedValue: whatsappAuthKeys.encryptedValue,
          })
          .from(whatsappAuthKeys)
          .where(
            and(
              eq(whatsappAuthKeys.workspaceId, workspaceId),
              eq(whatsappAuthKeys.sessionName, sessionName),
              eq(whatsappAuthKeys.keyType, type),
              inArray(whatsappAuthKeys.keyId, ids),
            ),
          );

        const rowMap = new Map(rows.map((row) => [row.keyId, row.encryptedValue]));
        const data = {} as { [id: string]: SignalDataTypeMap[T] };

        for (const id of ids) {
          const rawValue = rowMap.get(id);
          if (!rawValue) {
            continue;
          }

          const parsed = decryptAuthValue<SignalDataTypeMap[T]>(rawValue);
          const value =
            type === "app-state-sync-key"
              ? (proto.Message.AppStateSyncKeyData.fromObject(
                  parsed as unknown as Record<string, unknown>,
                ) as unknown as SignalDataTypeMap[T])
              : parsed;
          data[id] = value;
        }

        return data;
      },
      set: async (data) => {
        // Neon HTTP driver doesn't support SQL transactions, so commit sequentially.
        for (const [keyType, keyValues] of Object.entries(data)) {
          for (const [keyId, value] of Object.entries(keyValues ?? {})) {
            if (!value) {
              await db
                .delete(whatsappAuthKeys)
                .where(
                  and(
                    eq(whatsappAuthKeys.workspaceId, workspaceId),
                    eq(whatsappAuthKeys.sessionName, sessionName),
                    eq(whatsappAuthKeys.keyType, keyType),
                    eq(whatsappAuthKeys.keyId, keyId),
                  ),
                );
              continue;
            }

            const encryptedValue = encryptAuthValue(value);
            await db
              .insert(whatsappAuthKeys)
              .values({
                workspaceId,
                sessionName,
                keyType,
                keyId,
                encryptedValue,
                keyVersion: 1,
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [
                  whatsappAuthKeys.workspaceId,
                  whatsappAuthKeys.sessionName,
                  whatsappAuthKeys.keyType,
                  whatsappAuthKeys.keyId,
                ],
                set: {
                  encryptedValue,
                  keyVersion: 1,
                  updatedAt: new Date(),
                },
              });
          }
        }
      },
    },
  };

  const saveCreds = async (): Promise<void> => {
    const encryptedValue = encryptAuthValue(state.creds);
    await db
      .insert(whatsappAuthKeys)
      .values({
        workspaceId,
        sessionName,
        keyType: CREDS_KEY_TYPE,
        keyId: CREDS_KEY_ID,
        encryptedValue,
        keyVersion: 1,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          whatsappAuthKeys.workspaceId,
          whatsappAuthKeys.sessionName,
          whatsappAuthKeys.keyType,
          whatsappAuthKeys.keyId,
        ],
        set: {
          encryptedValue,
          keyVersion: 1,
          updatedAt: new Date(),
        },
      });
  };

  return { state, saveCreds };
};
