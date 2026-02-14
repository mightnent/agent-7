import { processManusWebhook, resolveProvidedSecret } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ secret: string }>;
  },
): Promise<Response> {
  const { secret } = await context.params;
  const providedSecret = resolveProvidedSecret(request, secret);
  return processManusWebhook(request, providedSecret);
}
