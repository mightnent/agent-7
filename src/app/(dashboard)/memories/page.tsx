"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type MemoryCategory = "preference" | "fact" | "decision" | "task_outcome" | "correction";

type MemoryItem = {
  id: string;
  category: MemoryCategory;
  content: string;
  confidence: number;
  createdAt: string;
  lastAccessedAt: string;
};

type MemoriesResponse = {
  status: "ok";
  page: number;
  pageSize: number;
  total: number;
  stats: {
    total: number;
    lastExtractionAt: string | null;
  };
  memories: MemoryItem[];
  warning?: string | null;
};

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: "Preference",
  fact: "Fact",
  decision: "Decision",
  task_outcome: "Task Outcome",
  correction: "Correction",
};

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
};

const confidencePercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value * 100)));

export default function MemoriesPage() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createCategory, setCreateCategory] = useState<MemoryCategory>("fact");
  const [createContent, setCreateContent] = useState("");
  const [createConfidence, setCreateConfidence] = useState("1");
  const [data, setData] = useState<MemoriesResponse | null>(null);

  const totalPages = useMemo(() => {
    if (!data || data.total === 0) {
      return 1;
    }

    return Math.max(1, Math.ceil(data.total / pageSize));
  }, [data, pageSize]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/memories?page=${page}&pageSize=${pageSize}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      setError(`Failed to load memories (${response.status})`);
      setData({
        status: "ok",
        page,
        pageSize,
        total: 0,
        stats: { total: 0, lastExtractionAt: null },
        memories: [],
        warning: "Memories API unavailable.",
      });
      return;
    }

    const payload = (await response.json()) as MemoriesResponse;
    setError(null);
    setData(payload);
  }, [page, pageSize]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        await load();
      } catch {
        setError("Failed to load memories.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {
      setError("Failed to refresh memories.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/memories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    const confirmed = window.confirm("Delete all memories?");
    if (!confirmed) {
      return;
    }

    setClearing(true);
    try {
      await fetch("/api/memories?all=true", { method: "DELETE" });
      setPage(1);
      await load();
    } finally {
      setClearing(false);
    }
  };

  const handleCreate = async () => {
    const content = createContent.trim();
    if (!content) {
      setError("Memory content is required.");
      return;
    }

    const confidenceNumeric = Number(createConfidence);
    if (!Number.isFinite(confidenceNumeric) || confidenceNumeric < 0 || confidenceNumeric > 1) {
      setError("Confidence must be between 0 and 1.");
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/memories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: createCategory,
          content,
          confidence: confidenceNumeric,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Failed to create memory (${response.status})`);
        return;
      }

      setCreateContent("");
      setCreateConfidence("1");
      setShowCreate(false);
      setError(null);
      await load();
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading memories...</p>;
  }

  const memories = data?.memories ?? [];

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Memory</p>
          <h2 className="mt-2 text-2xl font-semibold">Memories</h2>
          <p className="mt-2 text-sm text-muted-foreground">Read-only memory stream with delete controls.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Cancel Create" : "Create"}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void handleClearAll()} disabled={clearing || memories.length === 0}>
            {clearing ? "Clearing..." : "Clear All"}
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {data?.stats.total ?? 0} memories stored
            {data?.stats.lastExtractionAt ? ` · last extraction ${formatDateTime(data.stats.lastExtractionAt)}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
          {data?.warning ? <p className="mb-3 text-sm text-amber-600">{data.warning}</p> : null}
          {showCreate ? (
            <div className="mb-4 space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">Create memory</p>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Category</span>
                  <select
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5"
                    value={createCategory}
                    onChange={(event) => setCreateCategory(event.target.value as MemoryCategory)}
                  >
                    <option value="fact">Fact</option>
                    <option value="preference">Preference</option>
                    <option value="decision">Decision</option>
                    <option value="task_outcome">Task Outcome</option>
                    <option value="correction">Correction</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Confidence</span>
                  <input
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5"
                    value={createConfidence}
                    onChange={(event) => setCreateConfidence(event.target.value)}
                    placeholder="1"
                  />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Content</span>
                <textarea
                  className="min-h-24 w-full rounded-md border border-input bg-background px-2 py-1.5"
                  value={createContent}
                  onChange={(event) => setCreateContent(event.target.value)}
                  placeholder="User prefers short, practical responses."
                />
              </label>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void handleCreate()} disabled={creating}>
                  {creating ? "Creating..." : "Save Memory"}
                </Button>
              </div>
            </div>
          ) : null}
          {memories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No memories yet. Agent-7 will start learning as you use it.</p>
          ) : (
            <div className="space-y-3">
              {memories.map((memory) => (
                <article key={memory.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        {CATEGORY_LABELS[memory.category]}
                      </span>
                      <span className="text-xs text-muted-foreground">Confidence {confidencePercent(memory.confidence)}%</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDelete(memory.id)}
                      disabled={deletingId === memory.id}
                    >
                      {deletingId === memory.id ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                  <p className="mt-2 text-sm leading-6">{memory.content}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Created {formatDateTime(memory.createdAt)} · Last accessed {formatDateTime(memory.lastAccessedAt)}
                  </p>
                </article>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Previous
            </Button>
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
