import { after, NextResponse } from "next/server";

import { createNoopWhatsAppAdapter, getRuntimeWhatsAppAdapter } from "@/lib/channel/runtime-adapter";
import { getEnv } from "@/lib/env";
import { createEventProcessor, parseManusWebhookPayload } from "@/lib/orchestration/event-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ secret: string }>;
  },
): Promise<Response> {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json(
      {
        status: "invalid_payload",
      },
      { status: 400 },
    );
  }

  const { secret } = await context.params;
  const env = getEnv();
  if (secret !== env.MANUS_WEBHOOK_SECRET) {
    return NextResponse.json(
      {
        status: "unauthorized",
      },
      { status: 401 },
    );
  }

  const parsed = parseManusWebhookPayload(payload);
  if (!parsed) {
    return NextResponse.json(
      {
        status: "invalid_payload",
      },
      { status: 400 },
    );
  }

  const adapter = getRuntimeWhatsAppAdapter() ?? createNoopWhatsAppAdapter();
  const { DrizzleEventProcessorStore } = await import("@/lib/orchestration/event-processor.store");
  const store = new DrizzleEventProcessorStore();
  const eventProcessor = createEventProcessor({
    store,
    whatsappAdapter: adapter,
    sendProgressUpdates: false,
  });

  const now = new Date();
  const inserted = await store.insertWebhookEventIfNew({
    eventId: parsed.eventId,
    eventType: parsed.eventType,
    taskId: parsed.taskId,
    progressType: parsed.progressType,
    stopReason: parsed.stopReason,
    payload: parsed.payload,
    receivedAt: now,
    expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
  });

  if (!inserted) {
    return NextResponse.json({
      status: "duplicate",
      eventId: parsed.eventId,
    });
  }

  after(async () => {
    try {
      await eventProcessor.process(parsed);
      await store.markWebhookEventProcessed(parsed.eventId, new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown webhook processing error";
      await store.markWebhookEventFailed(parsed.eventId, new Date(), message);
    }
  });

  return NextResponse.json({
    status: "accepted",
    eventId: parsed.eventId,
  });
}
