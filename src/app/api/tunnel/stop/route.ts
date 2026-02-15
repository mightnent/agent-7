import { NextResponse } from "next/server";

import { requireOssApiAccess } from "@/lib/api/oss-admin-guard";
import { stopTunnel } from "@/lib/tunnel/manager";
import { resolveWorkspaceId } from "@/lib/workspace/default-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

  const workspaceId = resolveWorkspaceId();
  const tunnel = await stopTunnel(workspaceId);

  return NextResponse.json({ status: "ok", tunnel });
}
