# F14: Agent Memory

**Date**: 2026-02-17
**Status**: Draft
**Depends on**: F13 (Manus project + agent personality — complete)

## Problem Statement

1. **Agent-7 has no recall across sessions.** Every conversation starts from zero. The agent doesn't remember the user's name, timezone, past tasks, stated preferences, or prior decisions. This makes it feel like a new stranger every time.
2. **All messages go to Manus.** The current architecture routes every inbound message to Manus as a task. This means simple questions the agent should know the answer to ("What timezone am I in?", "What did you work on yesterday?") incur a full Manus task round-trip — slow, expensive, and unnecessary.
3. **Task results are fire-and-forget.** When Manus completes a task, the result is forwarded and forgotten. No facts are extracted. No learning accumulates. The agent doesn't get smarter with use.

## Goal

Add a persistent memory system that lets agent-7:

1. **Remember** — extract and store facts, preferences, decisions, and outcomes from conversations and task results.
2. **Recall** — retrieve relevant memories before constructing Manus task prompts, giving Manus user-specific context it wouldn't otherwise have.
3. **Respond locally** — answer certain messages directly from memory + LLM without creating a Manus task, making the agent faster and more conversational.
4. **Maintain** — compact, deduplicate, and prune memories over time so the store stays useful, not noisy.

## Task Tracker

### Phase 1: Memory table + write path

- [x] Add `agent_memories` table to DB schema and migration
- [x] Add memory store interface + Drizzle implementation
- [x] Add post-task memory extraction after `task_stopped` + `finish`
- [x] Add explicit memory detection for messages like `remember that...` / `my timezone is...`
- [x] Add contradiction/supersede handling for explicit and extracted updates

### Phase 2: Memory read path + task enrichment

- [x] Retrieve relevant memories before Manus task creation
- [x] Inject `Known context about this user` block into Manus prompt
- [x] Update `last_accessed_at` on memory retrieval
- [x] Wire memory store through inbound dispatch/task creation runtime

### Phase 3: Local response path

- [x] Extend router to support `respond` action
- [x] Add `ResponseIntent` classification (`memory_query`, `memory_write`, `chitchat`, `task_query`, `unclear`)
- [x] Add local responder (LLM + fallback heuristics) for direct WhatsApp replies
- [x] Add escalation path (`respond` -> Manus `new` task) when local responder is uncertain
- [x] Add DB enum migration for `route_action = respond`

### Phase 4: Memory maintenance + admin UI

- [x] Add memory cleanup (expiry + superseded retention) in cleanup flow
- [x] Add memories API (`GET` list/stats, `DELETE` one, `DELETE all`)
- [x] Add dashboard `/memories` page with list, stats, pagination, and delete controls
- [x] Add `Memories` navigation tab in sidebar

### Phase 5: Future work

- [ ] LLM-powered memory compaction
- [ ] Confidence decay
- [ ] Vector search (`pgvector`)
- [ ] LLM-powered semantic deduplication

## Implementation Status Summary

### Implemented

- DB migration for `agent_memories` and `route_action = respond`
- Memory store (insert/read/touch/supersede/admin list/delete/clear/stats)
- Prompt enrichment with memory context before Manus task creation
- Post-task extraction pipeline (`task_stopped` + `finish`) with structured memory writes
- Explicit memory write handling from inbound chat (including deterministic local fast-path)
- Local `respond` path (`memory_query`, `memory_write`, `chitchat`, `task_query`, `unclear`) with escalation fallback to Manus
- Memory cleanup integration (expired + superseded retention)
- Admin memory APIs (`GET`, `POST`, `DELETE`, `DELETE all`)
- Admin `/memories` UI (list, pagination, stats, delete, clear all, create memory)
- Graceful API/UI behavior when memory table is not migrated yet

### Not Implemented

- LLM-powered compaction of multiple memories into consolidated entries
- Confidence decay model over time
- Vector/semantic search via `pgvector`
- Semantic LLM deduplication workflow (current dedup is heuristic + supersede rules)
- Memory sharing across workspaces / multi-tenant memory strategy
- Proactive memory surfacing in future conversations (heartbeat-style prompts)

## Design Principles

1. **Start with structured rows, not embeddings.** A simple Postgres table with category-based filtering and recency ordering is sufficient for v1. Vector search adds complexity without clear benefit when the memory count is low (sub-1000). Add `pgvector` later if needed.
2. **Memory is a side effect, not a bottleneck.** Memory extraction happens asynchronously after task completion. Memory retrieval adds one fast DB query to the hot path. Neither should block or slow down the primary message flow.
3. **Local responses are an optimization, not a requirement.** The system works fine if every message still goes to Manus. Local response is a progressive enhancement for messages where memory alone provides the answer.
4. **Graceful degradation.** If the memory table is empty, behaviour is identical to today. If memory extraction fails, the task still completes normally. Memory is additive.

---

## Architecture

### New table: `agent_memories`

```sql
CREATE TABLE agent_memories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT
                     DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  category      TEXT NOT NULL,        -- 'preference', 'fact', 'decision', 'task_outcome', 'correction'
  content       TEXT NOT NULL,        -- natural language: "User's timezone is SGT (UTC+8)"
  source_type   TEXT NOT NULL,        -- 'extraction', 'explicit', 'inferred'
  source_task_id TEXT,                -- manus task ID that produced this memory
  source_message_id UUID,             -- inbound message that triggered this memory
  superseded_by UUID,                 -- points to the newer memory that replaced this one
  confidence    REAL NOT NULL DEFAULT 1.0,  -- 0.0–1.0
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,          -- null = no expiry

  CONSTRAINT valid_category CHECK (category IN ('preference', 'fact', 'decision', 'task_outcome', 'correction')),
  CONSTRAINT valid_source_type CHECK (source_type IN ('extraction', 'explicit', 'inferred'))
);

CREATE INDEX agent_memories_workspace_category_idx ON agent_memories(workspace_id, category);
CREATE INDEX agent_memories_workspace_created_at_idx ON agent_memories(workspace_id, created_at DESC);
CREATE INDEX agent_memories_workspace_accessed_at_idx ON agent_memories(workspace_id, last_accessed_at DESC);
CREATE INDEX agent_memories_superseded_idx ON agent_memories(superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX agent_memories_expires_at_idx ON agent_memories(expires_at) WHERE expires_at IS NOT NULL;
```

### Memory categories

| Category | Description | Example | Typical source | Default TTL |
|---|---|---|---|---|
| `preference` | How the user likes things done | "User prefers TypeScript over JavaScript" | extraction, explicit | None (permanent) |
| `fact` | Objective information about the user or their world | "User is based in Singapore, timezone SGT" | extraction, explicit | None (permanent) |
| `decision` | A choice the user made that might be referenced later | "User chose React over Vue for the dashboard project" | extraction | 90 days |
| `task_outcome` | What a completed task produced and whether the user was satisfied | "Built a landing page for the product launch, user approved" | extraction | 60 days |
| `correction` | User corrected the agent or Manus | "User clarified: company name is 'Acme Corp', not 'Acme Inc'" | extraction, explicit | None (permanent) |

### Source types

| Source | When created | Confidence |
|---|---|---|
| `extraction` | LLM extracts facts from a completed task interaction | 0.7–0.9 (LLM-assigned) |
| `explicit` | User directly says "remember that..." or states a fact | 1.0 |
| `inferred` | Agent infers from behaviour patterns (future — not in v1) | 0.3–0.6 |

### Memory lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                     MEMORY WRITE PATHS                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Post-task extraction (async, after task_stopped/finish)  │
│     ┌─────────────────────────────────────────────┐         │
│     │ Input:                                       │         │
│     │  - original user prompt                      │         │
│     │  - task result (last_message)                │         │
│     │  - task title                                │         │
│     │                                              │         │
│     │ LLM call:                                    │         │
│     │  "Extract facts, preferences, decisions,     │         │
│     │   and outcomes worth remembering."            │         │
│     │                                              │         │
│     │ Output:                                      │         │
│     │  [{category, content, confidence}] or []     │         │
│     └─────────────────────────────────────────────┘         │
│                                                              │
│  2. Explicit memory from user message                        │
│     ┌─────────────────────────────────────────────┐         │
│     │ Detected by router when message matches      │         │
│     │ patterns like:                               │         │
│     │  - "remember that..."                        │         │
│     │  - "my timezone is..."                       │         │
│     │  - "I prefer..."                             │         │
│     │  - "don't forget..."                         │         │
│     │                                              │         │
│     │ Stored with confidence 1.0, source=explicit  │         │
│     └─────────────────────────────────────────────┘         │
│                                                              │
│  3. Contradiction resolution                                 │
│     ┌─────────────────────────────────────────────┐         │
│     │ When a new memory contradicts an existing:   │         │
│     │  - Old memory gets superseded_by = new ID    │         │
│     │  - Old memory excluded from future queries   │         │
│     │  - Both records kept for audit               │         │
│     └─────────────────────────────────────────────┘         │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                     MEMORY READ PATHS                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Task prompt enrichment (before createTask)               │
│     Query: all non-superseded, non-expired memories          │
│     Categories: preference, fact, decision, correction       │
│     Limit: 30 most recently accessed                         │
│     Inject as: "Known context about the user: ..."           │
│     → Appended to Manus task prompt                          │
│                                                              │
│  2. Local response generation (new "respond" route action)   │
│     Query: relevant memories for answering the question      │
│     Used by: local LLM to craft a direct reply               │
│     → No Manus task created                                  │
│                                                              │
│  3. Personality-aware messaging (existing ack + framing)     │
│     No change — personality already injected via F13.         │
│     Memory enriches the Manus task, not the ack/framing.     │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                     MEMORY MAINTENANCE                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Expiry cleanup (runs on existing cleanup cron)           │
│     DELETE WHERE expires_at < now()                           │
│     DELETE WHERE superseded_by IS NOT NULL                    │
│           AND created_at < now() - INTERVAL '30 days'        │
│                                                              │
│  2. Compaction (periodic, LLM-powered — Phase 3)             │
│     When memory count > threshold (e.g. 200):                │
│     - Group by category                                      │
│     - LLM merges related memories into consolidated entries  │
│     - Supersede originals, insert merged versions            │
│     - E.g. 5 separate preference memories → 1 summary       │
│                                                              │
│  3. Confidence decay (Phase 3)                               │
│     Memories not accessed in 90+ days have confidence        │
│     reduced by 0.1 per period. Below 0.3 → eligible for     │
│     cleanup. Accessing a memory resets its decay clock.       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Architectural Change: Local Response Path

### The problem with routing everything to Manus

Today the router decides between `continue` (existing task) and `new` (create task). Every message results in a Manus API call. This is wrong for messages like:

- "What's my timezone?" → memory lookup, instant answer
- "Remember I prefer dark mode" → memory write, confirm
- "What did you do for me yesterday?" → query task_outcome memories
- "Thanks" / "ok" / "got it" → acknowledge, no task needed
- "Hey" / "good morning" → conversational, no task needed

These currently create Manus tasks that burn credits and add 10-30s latency for something the agent should handle in <2s.

### New router action: `respond`

Extend the task router to support three actions:

```typescript
type RouteAction = "continue" | "new" | "respond";

// Router decision shape:
type TaskRouterDecision =
  | { action: "continue"; taskId: string; reason: string }
  | { action: "new"; reason: string }
  | { action: "respond"; reason: string; responseIntent: ResponseIntent };

type ResponseIntent =
  | "memory_query"     // user asking something memory can answer
  | "memory_write"     // user explicitly stating a fact/preference
  | "chitchat"         // greeting, thanks, small talk
  | "task_query"       // asking about recent tasks/history
  | "unclear"          // too vague to create a task, ask for clarification
```

### How the router decides

The LLM classifier prompt gets extended:

```
You are a message router for a WhatsApp AI assistant.

Given:
- The user's message
- Currently active tasks
- A summary of what the agent knows about the user (from memory)

Decide:
1. "continue" — message relates to an active task → continue that task
2. "new" — message is a new task request that requires Manus execution
3. "respond" — message can be answered directly without Manus

Use "respond" when:
- User is asking about something the agent already knows (from memory)
- User is explicitly stating a preference or fact to remember
- User is making chitchat (greetings, thanks, acknowledgements)
- User is asking about past tasks or what the agent has done
- Message is too vague and needs clarification before creating a task

Use "new" when:
- The request requires web browsing, research, code generation, file creation,
  or any capability that requires Manus tool use
- The request is a substantive task that can't be answered from existing knowledge

When in doubt between "respond" and "new", prefer "new" — it's better to
over-delegate to Manus than to give a shallow local answer for a complex question.
```

### Local response handler

When the router returns `action: "respond"`, the orchestration layer handles it without Manus:

```
dispatchInboundMessage():
  if decision.action === "respond":
    1. Load memories relevant to the message
    2. Load personality
    3. LLM call with:
       - System: personality + "You are responding to a WhatsApp message directly"
       - Prompt: user message + relevant memories + intent
    4. Send response to WhatsApp
    5. Store outbound message in DB
    6. If intent is "memory_write":
       - Also extract and store the memory
    7. Return { action: "respond", ... }
```

### Updated message flow

```
WhatsApp inbound message
         │
         ▼
┌──── Task Router (LLM) ────────────────────────────┐
│                                                     │
│  Input: message + active tasks + memory summary     │
│                                                     │
│  ┌─────────┐  ┌─────────┐  ┌──────────────────┐   │
│  │continue │  │  new    │  │    respond        │   │
│  │         │  │         │  │                    │   │
│  │Continue │  │ Create  │  │ Handle locally:    │   │
│  │existing │  │ Manus   │  │ - memory query    │   │
│  │task     │  │ task    │  │ - memory write    │   │
│  │         │  │         │  │ - chitchat        │   │
│  │         │  │ + inject│  │ - task query      │   │
│  │         │  │ memory  │  │ - clarification   │   │
│  │         │  │ context │  │                    │   │
│  └────┬────┘  └────┬────┘  └───────┬────────────┘   │
│       │            │               │                │
└───────┼────────────┼───────────────┼────────────────┘
        │            │               │
        ▼            ▼               ▼
   Manus API    Manus API      Local LLM call
                                (memory + personality)
        │            │               │
        ▼            ▼               ▼
   WhatsApp      WhatsApp       WhatsApp
   response      ack → result   response
```

### Safeguards for the `respond` path

The local response path needs guardrails to avoid giving bad answers:

1. **Confidence threshold**: Only use memories with confidence >= 0.5 for local responses.
2. **Escape hatch**: If the local LLM is uncertain, it can return a signal that falls back to creating a Manus task. The response JSON includes an `escalate` boolean.
3. **Bias toward Manus**: The router prompt explicitly says "when in doubt, prefer new". Local response is for clear-cut cases.
4. **No tool use locally**: The local LLM can only respond with text. Anything requiring web browsing, file creation, or API calls must go to Manus.

---

## Memory Injection into Manus Tasks

When a new Manus task is created, relevant memories are prepended to the task prompt:

```
Original prompt: "Build me a landing page for my product"

With memory context:
---
Known context about this user:
- User is based in Singapore (SGT timezone)
- User prefers TypeScript and Next.js App Router patterns
- User likes simple, pragmatic solutions over clever ones
- User's company is called Acme Corp
- Last task: Built a React dashboard component (2 days ago, user approved)
---

User request: Build me a landing page for my product
```

This is additive to the Manus project instructions (F13). The difference:

| | Project Instructions (F13) | Memory Context (F14) |
|---|---|---|
| **Edited by** | User, manually in admin UI | Agent, automatically from conversations |
| **Scope** | Static, high-level guidance | Dynamic, accumulates over time |
| **Content** | "Always use TypeScript" | "User said their company is Acme Corp" |
| **Sent to Manus via** | Project-level instructions | Prepended to individual task prompt |

Both are sent. They complement each other. Project instructions are the user's deliberate configuration. Memory is what the agent has learned.

### What gets injected

Not all memories are relevant to every task. The retrieval query is:

```sql
SELECT content, category, confidence
FROM agent_memories
WHERE workspace_id = $1
  AND superseded_by IS NULL
  AND (expires_at IS NULL OR expires_at > now())
  AND confidence >= 0.5
ORDER BY
  CASE category
    WHEN 'preference' THEN 1
    WHEN 'fact' THEN 2
    WHEN 'correction' THEN 3
    WHEN 'decision' THEN 4
    WHEN 'task_outcome' THEN 5
  END,
  last_accessed_at DESC
LIMIT 30;
```

Preferences and facts first (most universally useful), then corrections, decisions, and outcomes. Capped at 30 to avoid bloating the prompt.

After retrieval, `last_accessed_at` is updated for all returned memories (batch UPDATE).

---

## Post-Task Memory Extraction

After a Manus task completes (`task_stopped` with `stop_reason = "finish"`), run an async memory extraction pass:

### Input to LLM

```json
{
  "system": "You extract memorable facts from completed task interactions. Return JSON array: [{\"category\": \"...\", \"content\": \"...\", \"confidence\": 0.0-1.0}]. Categories: preference, fact, decision, task_outcome, correction. Only include genuinely useful information — things that would help you do a better job on future tasks. If nothing is worth remembering, return []. Never fabricate facts.",
  "prompt": {
    "user_request": "Build me a landing page for Acme Corp",
    "task_title": "Landing page for Acme Corp",
    "task_result": "Created a Next.js landing page with...",
    "existing_memories": ["User prefers TypeScript", "User is in Singapore"]
  }
}
```

### Output

```json
[
  {"category": "fact", "content": "User's company is called Acme Corp", "confidence": 0.9},
  {"category": "task_outcome", "content": "Built a Next.js landing page for Acme Corp product launch", "confidence": 0.85}
]
```

### Deduplication

Before inserting, check for existing memories with similar content:

1. Query existing memories in the same category.
2. Pass existing + new to a small LLM call: "Are any of these new memories duplicates or updates of existing ones?"
3. If duplicate → skip.
4. If update/contradiction → insert new, mark old as `superseded_by`.
5. If genuinely new → insert.

For v1, this dedup check can be simple: exact substring match on `content` field. LLM-powered dedup is a Phase 2 enhancement.

---

## Admin Console UI

### Memory viewer — new `/memories` tab

A new top-level tab in the admin console called **"Memories"** (alongside the existing dashboard/config tabs):

- **Display**: Read-only table/list of current memories
  - Columns: Category (badge), Content, Confidence (bar/percentage), Created, Last Accessed
  - Sorted by last_accessed_at DESC
  - Paginated (20 per page)
- **Actions per memory**:
  - **Delete** — removes the memory (sets superseded_by to a tombstone or hard deletes)
- **Bulk actions**:
  - **Clear all** — deletes all memories (with confirmation dialog)
- **Stats bar**: "42 memories stored. Last extraction: 2 hours ago."
- **Empty state**: *"No memories yet. Agent-7 will start learning about you as you use it."*

### No manual memory creation in v1

Users don't create memories through the UI — they tell the agent on WhatsApp ("remember that I prefer dark mode") or let it extract from tasks. The UI is for viewing and cleanup only.

---

## Implementation

### Phase 1: Memory table + write path

**Scope**:
- Add `agent_memories` table to schema + migration
- Add memory extraction after task completion (async, in event-processor)
- Add explicit memory detection (basic keyword matching for "remember that..." patterns)
- Memory store interface + Postgres implementation

**Deliverables**:
- `src/db/schema.ts` — add `agentMemories` table
- `src/lib/memory/store.ts` — memory read/write interface + implementation
- `src/lib/memory/extraction.ts` — post-task memory extraction LLM call
- `src/lib/orchestration/event-processor.ts` — wire extraction after task_stopped/finish
- DB migration

**Success criteria**:
- After a Manus task completes, relevant memories are extracted and stored
- Memories visible in DB with correct categories and confidence
- "Remember that..." messages on WhatsApp store explicit memories
- Empty memory table doesn't change existing behaviour

### Phase 2: Memory read path + task enrichment

**Scope**:
- Load relevant memories before Manus task creation
- Inject memory context into task prompt
- Update `last_accessed_at` on retrieved memories
- Wire into `task-creation.ts`

**Deliverables**:
- `src/lib/memory/retrieval.ts` — memory query + formatting for prompt injection
- `src/lib/orchestration/task-creation.ts` — inject memory context into prompt
- `src/lib/orchestration/inbound-dispatch.ts` — pass memory store through deps

**Success criteria**:
- Manus tasks receive memory context in prompt
- Task results improve based on known user preferences
- Memory access timestamps update on use
- No performance regression (memory query adds <50ms to task creation)

### Phase 3: Local response path

**Scope**:
- Extend router to support `respond` action
- Add `ResponseIntent` classification
- Add local response handler (LLM + memory + personality → WhatsApp reply)
- Add `respond` to `route_action` enum in DB schema
- Wire into `inbound-dispatch.ts`

**Deliverables**:
- `src/lib/routing/task-router.ts` — extend with `respond` action + intents
- `src/lib/orchestration/local-responder.ts` — local LLM response handler
- `src/lib/orchestration/inbound-dispatch.ts` — handle `respond` action
- DB migration — add `respond` to `route_action` enum

**Success criteria**:
- "What's my timezone?" → answered locally from memory, no Manus task
- "Remember I prefer dark mode" → stored as memory, confirmed locally
- "Thanks" → acknowledged locally, no Manus task
- Complex requests still routed to Manus
- Router fallback: if uncertain, routes to Manus (never gives bad local answer)
- Escalation: local responder can punt to Manus if it can't answer confidently

### Phase 4: Memory maintenance + admin UI

**Scope**:
- Expiry cleanup in existing cleanup cron
- Superseded memory cleanup (30 day retention)
- Simple deduplication on write (substring match)
- Admin console memory viewer
- Memory stats

**Deliverables**:
- `src/app/api/cleanup/route.ts` — add memory cleanup
- `src/lib/memory/maintenance.ts` — expiry + superseded cleanup
- `src/app/(dashboard)/memories/page.tsx` — memory list page (new tab)
- `src/app/api/memories/route.ts` — GET (list), DELETE endpoints

**Success criteria**:
- Expired memories cleaned up automatically
- Superseded memories cleaned up after 30 days
- Admin can view and delete memories
- Memory count and last extraction time visible

### Phase 5 (future): Smart compaction + vector search

**Scope** (not in this feature — documented for reference):
- LLM-powered memory compaction (merge related memories)
- Confidence decay for stale memories
- `pgvector` integration for semantic memory search
- LLM-powered deduplication on write

---

## Example Interactions

### With memory — task enrichment

```
User: "Build me an API endpoint for user auth"

[Agent-7 retrieves memories]:
- User prefers TypeScript
- User uses Next.js App Router
- User's project uses Drizzle ORM + Neon Postgres
- User prefers simple solutions

[Manus receives]:
"Known context: User prefers TypeScript, Next.js App Router, Drizzle ORM + Neon.
Prefers simple, pragmatic solutions.

User request: Build me an API endpoint for user auth"

[Manus builds auth endpoint using the right stack without asking]
```

### With memory — local response

```
User: "What timezone am I in?"

[Router: action=respond, intent=memory_query]
[Memory lookup: "User is based in Singapore, timezone SGT (UTC+8)"]

Agent-7: "You're in SGT (UTC+8), Singapore."

[No Manus task created. Response in <2s.]
```

### With memory — explicit write

```
User: "Remember that my company is called Nexus Labs"

[Router: action=respond, intent=memory_write]
[Memory: check for existing 'company name' fact]
[Found: "User's company is called Acme Corp" — mark superseded]
[Insert: category=fact, content="User's company is called Nexus Labs", confidence=1.0, source=explicit]

Agent-7: "Noted — your company is Nexus Labs. Updated from the previous name."
```

### Without memory — graceful degradation

```
[Memory table empty, no memories configured]

User: "Build me a landing page"

[Router: action=new (no memory summary to influence routing)]
[Task creation: prompt sent to Manus without memory context]
[Everything works exactly as it does today]
```

---

## What this does NOT cover (future work)

| Concern | Why deferred |
|---|---|
| Vector/semantic search for memories | Start with category + recency filtering. Add pgvector when memory count warrants it. |
| LLM-powered compaction | Start with simple expiry-based cleanup. Add LLM merging when memory volume becomes a problem. |
| Confidence decay over time | Start with fixed confidence. Add time-based decay when the memory store is mature enough to evaluate. |
| Memory sharing across workspaces | Single-tenant for now. Multi-tenant memory is a separate concern. |
| User-created memories in admin UI | Users create memories via WhatsApp ("remember that..."). UI is view/delete only in v1. |
| Memory-aware ack/delivery framing | Memory enriches Manus tasks. Personality (F13) handles ack/delivery tone. Keep them separate. |
| Proactive memory surfacing | "You mentioned last week you wanted to check on X" — this is heartbeat territory (future F15). |
