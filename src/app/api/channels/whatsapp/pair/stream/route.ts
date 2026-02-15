import { requireOssApiAccess } from "@/lib/api/oss-admin-guard";
import { subscribePairing } from "@/lib/channel/whatsapp-pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

const asSseChunk = (event: string, payload: unknown): Uint8Array => {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
};

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

  let unsubscribe: (() => void) | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let closed = false;
  let closeStream: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      closeStream = () => {
        if (closed) {
          return;
        }
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
        }
        if (unsubscribe) {
          unsubscribe();
        }
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };

      request.signal.addEventListener("abort", () => {
        closeStream?.();
      });

      unsubscribe = subscribePairing((snapshot) => {
        if (closed) {
          return;
        }
        controller.enqueue(asSseChunk("pairing", snapshot));
      });

      heartbeat = setInterval(() => {
        if (closed) {
          return;
        }
        controller.enqueue(asSseChunk("heartbeat", { ts: new Date().toISOString() }));
      }, 15_000);
    },
    cancel() {
      closeStream?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
