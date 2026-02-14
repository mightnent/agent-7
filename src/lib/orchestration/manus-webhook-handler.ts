import {
  parseManusWebhookPayload,
  type EventProcessor,
} from "./event-processor";
import type { WebhookEventLifecycleStore } from "./event-processor.store";

const WEBHOOK_EVENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface HandleManusWebhookInput {
  providedSecret: string;
  expectedSecret: string;
  payload: unknown;
  lifecycleStore: WebhookEventLifecycleStore;
  eventProcessor: EventProcessor;
  now?: () => Date;
}

export interface HandleManusWebhookResult {
  status: number;
  body: {
    status: "unauthorized" | "invalid_payload" | "duplicate" | "processed" | "failed";
    eventId?: string;
    error?: string;
  };
}

export const handleManusWebhook = async (input: HandleManusWebhookInput): Promise<HandleManusWebhookResult> => {
  const now = input.now ?? (() => new Date());

  if (input.providedSecret !== input.expectedSecret) {
    return {
      status: 401,
      body: {
        status: "unauthorized",
      },
    };
  }

  const parsed = parseManusWebhookPayload(input.payload);
  if (!parsed) {
    return {
      status: 400,
      body: {
        status: "invalid_payload",
      },
    };
  }

  const inserted = await input.lifecycleStore.insertWebhookEventIfNew({
    eventId: parsed.eventId,
    eventType: parsed.eventType,
    taskId: parsed.taskId,
    progressType: parsed.progressType,
    stopReason: parsed.stopReason,
    payload: parsed.payload,
    receivedAt: now(),
    expiresAt: new Date(now().getTime() + WEBHOOK_EVENT_TTL_MS),
  });

  if (!inserted) {
    return {
      status: 200,
      body: {
        status: "duplicate",
        eventId: parsed.eventId,
      },
    };
  }

  try {
    await input.eventProcessor.process(parsed);
    await input.lifecycleStore.markWebhookEventProcessed(parsed.eventId, now());

    return {
      status: 200,
      body: {
        status: "processed",
        eventId: parsed.eventId,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook processing error";
    await input.lifecycleStore.markWebhookEventFailed(parsed.eventId, now(), message);

    return {
      status: 500,
      body: {
        status: "failed",
        eventId: parsed.eventId,
        error: message,
      },
    };
  }
};
