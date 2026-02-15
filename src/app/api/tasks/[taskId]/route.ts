import { NextResponse } from "next/server";

import { requireOssApiAccess } from "@/lib/api/oss-admin-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: {
    params: Promise<{ taskId: string }>;
  },
): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
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
