import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
): Promise<Response> {
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

  const { id } = await context.params;
  const { DrizzleReadApiStore } = await import("@/lib/ops/read-api.store");
  const store = new DrizzleReadApiStore();

  const session = await store.getSessionView(id);
  if (!session) {
    return NextResponse.json(
      {
        status: "not_found",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    status: "ok",
    session,
  });
}
