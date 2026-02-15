import { NextResponse } from "next/server";

import { requireOssApiAccess } from "@/lib/api/oss-admin-guard";
import { startTunnel } from "@/lib/tunnel/manager";
import { resolveWorkspaceId } from "@/lib/workspace/default-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

  const workspaceId = resolveWorkspaceId();
  const tunnel = await startTunnel(workspaceId);

  const statusCode = tunnel.status === "error" ? 500 : 200;
  return NextResponse.json({ status: "ok", tunnel }, { status: statusCode });
}
