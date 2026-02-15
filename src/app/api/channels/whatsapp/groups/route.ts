import { NextResponse } from "next/server";

import { requireOssAdminRequest } from "@/lib/api/oss-admin-guard";
import { getBaileysRuntimeSocket, getBaileysRuntimeState } from "@/lib/channel/whatsapp-bootstrap";
import { getPairingSnapshot, getPairingSocket } from "@/lib/channel/whatsapp-pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = requireOssAdminRequest(request);
  if (guard) {
    return guard;
  }

  const runtime = getBaileysRuntimeState();
  const pairing = getPairingSnapshot();
  const socket = getPairingSocket() ?? getBaileysRuntimeSocket();

  const isConnected = runtime.connected || pairing.status === "connected";

  if (!socket || !isConnected) {
    return NextResponse.json(
      {
        status: "not_connected",
        groups: [],
      },
      { status: 503 },
    );
  }

  const rawGroups = await socket.groupFetchAllParticipating();
  const groups = rawGroups as Record<string, { subject?: unknown }>;
  const items = Object.entries(groups)
    .map(([jid, meta]) => ({
      jid,
      name: typeof meta.subject === "string" ? meta.subject : jid,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    status: "ok",
    groups: items,
  });
}
