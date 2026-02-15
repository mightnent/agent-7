import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOssAdminRequest } from "@/lib/api/oss-admin-guard";
import type { BotConfig } from "@/lib/channel/bot-config";
import { saveWorkspaceBotConfig } from "@/lib/channel/workspace-channel-service";
import { getEnv } from "@/lib/env";
import { resolveWorkspaceId } from "@/lib/workspace/default-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatSchema = z.object({
  jid: z.string().regex(/^[0-9A-Za-z._:-]+@(s\.whatsapp\.net|g\.us|lid)$/),
  name: z.string().min(1),
  requiresTrigger: z.boolean(),
  isMain: z.boolean().default(false),
});

const putConfigSchema = z.object({
  assistantName: z.string().min(1),
  mainChannelJid: z.string().regex(/^[0-9A-Za-z._:-]+@(s\.whatsapp\.net|g\.us|lid)$/),
  mainChannelName: z.string().min(1),
  mainChannelRequiresTrigger: z.boolean().default(true),
  chats: z.array(chatSchema),
});

export async function PUT(request: Request): Promise<Response> {
  const guard = requireOssAdminRequest(request);
  if (guard) {
    return guard;
  }

  const body = await request.json().catch(() => null);
  const parsed = putConfigSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        status: "invalid_payload",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const workspaceId = resolveWorkspaceId();
  const env = await getEnv(workspaceId);

  const registeredChats: BotConfig["registeredChats"] = {};

  for (const chat of parsed.data.chats) {
    registeredChats[chat.jid] = {
      name: chat.name,
      requiresTrigger: chat.requiresTrigger,
      isMain: chat.isMain || chat.jid === parsed.data.mainChannelJid,
    };
  }

  if (!registeredChats[parsed.data.mainChannelJid]) {
    registeredChats[parsed.data.mainChannelJid] = {
      name: parsed.data.mainChannelName,
      requiresTrigger: parsed.data.mainChannelRequiresTrigger,
      isMain: true,
    };
  }

  const config: BotConfig = {
    assistantName: parsed.data.assistantName,
    mainChannel: {
      jid: parsed.data.mainChannelJid,
      name: parsed.data.mainChannelName,
      requiresTrigger: parsed.data.mainChannelRequiresTrigger,
    },
    registeredChats,
  };

  await saveWorkspaceBotConfig(config, {
    workspaceId,
    authDir: env.WHATSAPP_AUTH_DIR,
  });

  return NextResponse.json({
    status: "ok",
    config,
  });
}
