import { NextResponse } from "next/server";

import { requireOssAdminRequest } from "@/lib/api/oss-admin-guard";
import { getBaileysRuntimeState } from "@/lib/channel/whatsapp-bootstrap";
import { getPairingSnapshot } from "@/lib/channel/whatsapp-pairing";
import { getWhatsAppChannelState, loadWorkspaceBotConfig } from "@/lib/channel/workspace-channel-service";
import { getEnv } from "@/lib/env";
import { resolveWorkspaceId } from "@/lib/workspace/default-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = requireOssAdminRequest(request);
  if (guard) {
    return guard;
  }

  const workspaceId = resolveWorkspaceId();
  const env = await getEnv(workspaceId);

  const [channelState, botConfig] = await Promise.all([
    getWhatsAppChannelState(workspaceId),
    loadWorkspaceBotConfig(workspaceId, env.WHATSAPP_AUTH_DIR),
  ]);

  return NextResponse.json({
    status: "ok",
    runtime: getBaileysRuntimeState(),
    pairing: getPairingSnapshot(),
    connection: channelState,
    config: botConfig,
  });
}
