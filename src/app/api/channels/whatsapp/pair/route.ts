import { NextResponse } from "next/server";

import { requireOssAdminRequest } from "@/lib/api/oss-admin-guard";
import { getEnv } from "@/lib/env";
import { resolveWorkspaceId } from "@/lib/workspace/default-workspace";
import { startPairing } from "@/lib/channel/whatsapp-pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = requireOssAdminRequest(request);
  if (guard) {
    return guard;
  }

  const workspaceId = resolveWorkspaceId();
  const env = await getEnv(workspaceId);

  const snapshot = await startPairing({
    workspaceId,
    sessionName: env.WHATSAPP_SESSION_NAME,
    authDir: env.WHATSAPP_AUTH_DIR,
  });

  return NextResponse.json({
    status: "ok",
    pairing: snapshot,
  });
}
