import { NextResponse } from "next/server";

import { requireOssApiAccess } from "@/lib/api/oss-admin-guard";
import { getTunnelStatus } from "@/lib/tunnel/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

  const tunnel = getTunnelStatus();
  return NextResponse.json({ status: "ok", tunnel });
}
