import { after, NextResponse } from "next/server";

import { getRuntimeWhatsAppAdapter } from "@/lib/channel/runtime-adapter";
import { getEnv } from "@/lib/env";
import { createMemoryLlmClientFromEnv } from "@/lib/memory/runtime";
import { DrizzleAgentMemoryStore } from "@/lib/memory/store";
import { createEventProcessor, parseManusWebhookPayload } from "@/lib/orchestration/event-processor";
import { createPersonalityMessageRendererFromEnv } from "@/lib/orchestration/personality";

const WEBHOOK_EVENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const readSecretFromRequest = (request: Request): string | null => {
  const headerSecret = request.headers.get("x-manus-webhook-secret")?.trim();
  if (headerSecret) {
    return headerSecret;
  }

  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret")?.trim();
  if (querySecret) {
    return querySecret;
  }

  return null;
};

export const resolveProvidedSecret = (request: Request, pathSecret?: string): string => {
  return pathSecret?.trim() || readSecretFromRequest(request) || "";
};

export const processManusWebhook = async (
  request: Request,
  providedSecret: string,
): Promise<Response> => {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json(
      {
        status: "invalid_payload",
      },
      { status: 400 },
    );
  }

  const env = await getEnv();
  if (providedSecret !== env.MANUS_WEBHOOK_SECRET) {
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

  const runtimeAdapter = getRuntimeWhatsAppAdapter();
  if (!runtimeAdapter) {
    console.warn("Runtime WhatsApp adapter unavailable for webhook processing, attempting bootstrap");
    const { bootBaileys } = await import("@/lib/channel/whatsapp-bootstrap");
    await bootBaileys();
  }

  const adapter = getRuntimeWhatsAppAdapter();
  if (!adapter) {
    console.warn("Runtime WhatsApp adapter still unavailable after bootstrap");
    return NextResponse.json(
      {
        status: "adapter_unavailable",
      },
      { status: 503 },
    );
  }

  const { DrizzleEventProcessorStore } = await import("@/lib/orchestration/event-processor.store");
  const store = new DrizzleEventProcessorStore();
  const memoryStore = new DrizzleAgentMemoryStore();
  const memoryExtractionLlmClient = await createMemoryLlmClientFromEnv();
  const personalityRenderer = await createPersonalityMessageRendererFromEnv();
  const eventProcessor = createEventProcessor({
    store,
    whatsappAdapter: adapter,
    personalityRenderer,
    memoryStore,
    memoryExtractionLlmClient,
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
    expiresAt: new Date(now.getTime() + WEBHOOK_EVENT_TTL_MS),
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
};
