import { processManusWebhook, resolveProvidedSecret } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const providedSecret = resolveProvidedSecret(request);
  return processManusWebhook(request, providedSecret);
}
