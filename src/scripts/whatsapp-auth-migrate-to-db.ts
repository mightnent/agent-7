#!/usr/bin/env npx tsx

import * as fs from "node:fs";
import * as path from "node:path";
import { BufferJSON } from "@whiskeysockets/baileys/lib/Utils/generics.js";
import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { encryptSetting } from "@/lib/crypto/settings-cipher";
import { DEFAULT_WORKSPACE_ID, whatsappAuthKeys } from "@/db/schema";

const authDir = process.env.WHATSAPP_AUTH_DIR ?? "./.data/whatsapp-auth";
const workspaceId = process.env.WORKSPACE_ID ?? DEFAULT_WORKSPACE_ID;
const sessionName = process.env.WHATSAPP_SESSION_NAME ?? "default";
const overwrite = process.env.WHATSAPP_AUTH_MIGRATE_OVERWRITE === "1";

const keyInfoFromFile = (fileName: string): { keyType: string; keyId: string } | null => {
  if (!fileName.endsWith(".json")) {
    return null;
  }

  if (fileName === "creds.json") {
    return { keyType: "creds", keyId: "main" };
  }

  if (fileName === "bot-config.json") {
    return null;
  }

  const base = fileName.slice(0, -".json".length);
  const dashIndex = base.lastIndexOf("-");
  if (dashIndex <= 0 || dashIndex === base.length - 1) {
    return null;
  }

  return {
    keyType: base.slice(0, dashIndex),
    keyId: base.slice(dashIndex + 1),
  };
};

async function main(): Promise<void> {
  if (!fs.existsSync(authDir)) {
    throw new Error(`Auth directory not found: ${authDir}`);
  }

  const files = fs.readdirSync(authDir);
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const fileName of files) {
    const keyInfo = keyInfoFromFile(fileName);
    if (!keyInfo) {
      continue;
    }

    try {
      const filePath = path.join(authDir, fileName);
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const plaintext = JSON.stringify(parsed, BufferJSON.replacer);
      const encryptedValue = encryptSetting(plaintext).toString("base64");

      if (overwrite) {
        await db
          .insert(whatsappAuthKeys)
          .values({
            workspaceId,
            sessionName,
            keyType: keyInfo.keyType,
            keyId: keyInfo.keyId,
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
        migrated += 1;
        continue;
      }

      const [existing] = await db
        .select({ id: whatsappAuthKeys.id })
        .from(whatsappAuthKeys)
        .where(
          and(
            eq(whatsappAuthKeys.workspaceId, workspaceId),
            eq(whatsappAuthKeys.sessionName, sessionName),
            eq(whatsappAuthKeys.keyType, keyInfo.keyType),
            eq(whatsappAuthKeys.keyId, keyInfo.keyId),
          ),
        )
        .limit(1);

      if (existing) {
        skipped += 1;
        continue;
      }

      await db.insert(whatsappAuthKeys).values({
        workspaceId,
        sessionName,
        keyType: keyInfo.keyType,
        keyId: keyInfo.keyId,
        encryptedValue,
        keyVersion: 1,
        updatedAt: new Date(),
      });
      migrated += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping ${fileName}: ${message}`);
    }
  }

  console.log(
    `Auth migration complete. migrated=${migrated} skipped=${skipped} failed=${failed} source=${authDir}`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to migrate auth state: ${message}`);
  process.exit(1);
});
