import { DrizzleReadApiStore } from "@/lib/ops/read-api.store";

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export default async function DashboardIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string }>;
}) {
  const store = new DrizzleReadApiStore();
  const params = await searchParams;
  const requestedTaskId = params.task?.trim() || null;
  const fallbackTaskId = requestedTaskId ? null : await store.getLatestTaskId();
  const activeTaskId = requestedTaskId ?? fallbackTaskId;
  const thread = activeTaskId ? await store.getTaskThread(activeTaskId) : null;

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {!thread ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No Manus tasks found. Start a task to see a message thread.</p>
        </div>
      ) : (
        <>
          <header className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Task</p>
            <h1 className="mt-1 text-lg font-semibold">{thread.task.taskTitle?.trim() || thread.task.taskId}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {thread.task.status.toUpperCase()} · Updated {formatTime(thread.task.updatedAt)}
            </p>
          </header>

          <div className="rounded-xl border border-border bg-card p-3 md:p-4">
            <div className="flex max-h-[calc(100vh-14rem)] flex-col gap-3 overflow-y-auto pr-1">
              {thread.messages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No messages are linked to this task yet.
                </div>
              ) : (
                thread.messages.map((message) => {
                  const isOutbound = message.direction === "outbound";
                  return (
                    <article
                      key={message.id}
                      className={`max-w-[85%] rounded-xl border px-3 py-2 text-sm ${
                        isOutbound
                          ? "ml-auto border-foreground/15 bg-foreground/5"
                          : "mr-auto border-border bg-muted/40"
                      }`}
                    >
                      <p className="whitespace-pre-wrap leading-6">{message.contentText?.trim() || "(empty message)"}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                        {message.direction} · {formatTime(message.createdAt)}
                      </p>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
