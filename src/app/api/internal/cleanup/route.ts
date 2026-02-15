import { NextResponse } from "next/server";

import { createNoopWhatsAppAdapter, getRuntimeWhatsAppAdapter } from "@/lib/channel/runtime-adapter";
import { getEnv } from "@/lib/env";
import { createManusClientFromEnv } from "@/lib/manus/client";
import { runCleanup } from "@/lib/ops/cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const env = await getEnv();
  const provided = request.headers.get("x-internal-token");

  if (!provided || provided !== env.INTERNAL_CLEANUP_TOKEN) {
    return NextResponse.json(
      {
        status: "unauthorized",
      },
      { status: 401 },
    );
  }

  const { DrizzleCleanupStore } = await import("@/lib/ops/cleanup.store");
  const adapter = getRuntimeWhatsAppAdapter() ?? createNoopWhatsAppAdapter();

  const manusClient = await createManusClientFromEnv();
  const summary = await runCleanup({
    store: new DrizzleCleanupStore(),
    whatsappAdapter: adapter,
    manusClient,
  });

  return NextResponse.json({
    status: "ok",
    summary,
  });
}
