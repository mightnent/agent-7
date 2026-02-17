import { NextResponse } from "next/server";

import { requireOssApiAccess } from "@/lib/api/oss-admin-guard";
import { createNoopWhatsAppAdapter, getRuntimeWhatsAppAdapter } from "@/lib/channel/runtime-adapter";
import { createManusClientFromEnv } from "@/lib/manus/client";
import { DrizzleAgentMemoryStore } from "@/lib/memory/store";
import { runCleanup } from "@/lib/ops/cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

  const { DrizzleCleanupStore } = await import("@/lib/ops/cleanup.store");
  const adapter = getRuntimeWhatsAppAdapter() ?? createNoopWhatsAppAdapter();

  const manusClient = await createManusClientFromEnv();
  const summary = await runCleanup({
    store: new DrizzleCleanupStore(),
    whatsappAdapter: adapter,
    manusClient,
    memoryStore: new DrizzleAgentMemoryStore(),
  });

  return NextResponse.json({
    status: "ok",
    summary,
  });
}
