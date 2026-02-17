import { NextResponse } from "next/server";

import { requireOssApiAccess } from "@/lib/api/oss-admin-guard";
import { DrizzleAgentMemoryStore } from "@/lib/memory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isMissingMemoryTableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("agent_memories") && message.includes("does not exist");
};

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize") || "20")));

  const store = new DrizzleAgentMemoryStore();
  let list;
  let stats;
  let warning: string | null = null;

  try {
    [list, stats] = await Promise.all([
      store.listAdmin({ page, pageSize }),
      store.getStats(),
    ]);
  } catch (error) {
    if (!isMissingMemoryTableError(error)) {
      throw error;
    }

    list = { total: 0, items: [] };
    stats = { total: 0, lastExtractionAt: null };
    warning = "Memory table not found. Run database migrations to enable memory storage.";
  }

  return NextResponse.json({
    status: "ok",
    page,
    pageSize,
    total: list.total,
    stats,
    memories: list.items,
    warning,
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

  const url = new URL(request.url);
  const all = url.searchParams.get("all") === "true";
  const id = url.searchParams.get("id")?.trim() ?? "";

  const store = new DrizzleAgentMemoryStore();

  if (all) {
    let deleted = 0;
    try {
      deleted = await store.clearAll();
    } catch (error) {
      if (!isMissingMemoryTableError(error)) {
        throw error;
      }
    }
    return NextResponse.json({
      status: "ok",
      deleted,
    });
  }

  if (!id) {
    return NextResponse.json(
      {
        status: "invalid_request",
        error: "Provide id or all=true",
      },
      { status: 400 },
    );
  }

  let deleted = false;
  try {
    deleted = await store.deleteMemory(id);
  } catch (error) {
    if (!isMissingMemoryTableError(error)) {
      throw error;
    }
  }
  if (!deleted) {
    return NextResponse.json(
      {
        status: "not_found",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    status: "ok",
    deleted: 1,
  });
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

  const payload = (await request.json().catch(() => null)) as
    | {
        category?: "preference" | "fact" | "decision" | "task_outcome" | "correction";
        content?: string;
        confidence?: number;
      }
    | null;

  if (!payload) {
    return NextResponse.json(
      {
        status: "invalid_request",
        error: "Invalid JSON body",
      },
      { status: 400 },
    );
  }

  const category = payload.category;
  const content = payload.content?.trim() ?? "";
  const confidenceRaw = typeof payload.confidence === "number" ? payload.confidence : 1;
  const confidence = Math.max(0, Math.min(1, confidenceRaw));

  const validCategory =
    category === "preference" ||
    category === "fact" ||
    category === "decision" ||
    category === "task_outcome" ||
    category === "correction";

  if (!validCategory || !content) {
    return NextResponse.json(
      {
        status: "invalid_request",
        error: "category and content are required",
      },
      { status: 400 },
    );
  }

  const store = new DrizzleAgentMemoryStore();
  try {
    const now = new Date();
    const id = await store.insertMemory({
      category,
      content,
      sourceType: "explicit",
      confidence,
      sourceTaskId: null,
      sourceMessageId: null,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: null,
    });

    return NextResponse.json({
      status: "ok",
      id,
    });
  } catch (error) {
    if (!isMissingMemoryTableError(error)) {
      throw error;
    }

    return NextResponse.json(
      {
        status: "not_ready",
        error: "Memory table not found. Run database migrations first.",
      },
      { status: 503 },
    );
  }
}
