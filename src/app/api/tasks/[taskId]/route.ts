import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: {
    params: Promise<{ taskId: string }>;
  },
): Promise<Response> {
  const env = getEnv();
  const provided = request.headers.get("x-internal-token");
  if (!provided || provided !== env.INTERNAL_CLEANUP_TOKEN) {
    return NextResponse.json(
      {
        status: "unauthorized",
      },
      { status: 401 },
    );
  }

  const { taskId } = await context.params;
  const { DrizzleReadApiStore } = await import("@/lib/ops/read-api.store");
  const store = new DrizzleReadApiStore();

  const task = await store.getTaskView(taskId);
  if (!task) {
    return NextResponse.json(
      {
        status: "not_found",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    status: "ok",
    task,
  });
}
