import * as fs from "node:fs";
import * as path from "node:path";

import { and, eq } from "drizzle-orm";
import { useMultiFileAuthState as loadMultiFileAuthState } from "@whiskeysockets/baileys/lib/Utils/use-multi-file-auth-state.js";
import type { AuthenticationState } from "@whiskeysockets/baileys/lib/Types/Auth.js";

import { db } from "@/db/client";
import { whatsappAuthKeys } from "@/db/schema";

import { loadDbAuthState } from "./db-auth-state";

export const loadWorkspaceAuthState = async (input: {
  workspaceId: string;
  sessionName: string;
  authDir: string;
}): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; backend: "db" | "filesystem" }> => {
  try {
    const dbState = await loadDbAuthState({
      workspaceId: input.workspaceId,
      sessionName: input.sessionName,
    });

    return {
      ...dbState,
      backend: "db",
    };
  } catch {
    const fsState = await loadMultiFileAuthState(input.authDir);
    return {
      ...fsState,
      backend: "filesystem",
    };
  }
};

export const clearWorkspaceAuthState = async (input: {
  workspaceId: string;
  sessionName: string;
  authDir: string;
}): Promise<void> => {
  await db
    .delete(whatsappAuthKeys)
    .where(
      and(
        eq(whatsappAuthKeys.workspaceId, input.workspaceId),
        eq(whatsappAuthKeys.sessionName, input.sessionName),
      ),
    )
    .catch(() => {
      // If DB is unavailable, continue and clear filesystem fallback auth state.
    });

  if (!fs.existsSync(input.authDir)) {
    return;
  }

  for (const file of fs.readdirSync(input.authDir)) {
    if (file === "bot-config.json") {
      continue;
    }

    fs.rmSync(path.join(input.authDir, file), { force: true, recursive: true });
  }
};
