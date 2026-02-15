import { NextResponse } from "next/server";

import { requireOssApiAccess } from "@/lib/api/oss-admin-guard";
import { disconnectBaileysRuntime } from "@/lib/channel/whatsapp-bootstrap";
import { disconnectPairing } from "@/lib/channel/whatsapp-pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

  await Promise.all([disconnectPairing(), disconnectBaileysRuntime()]);

  return NextResponse.json({
    status: "ok",
  });
}
