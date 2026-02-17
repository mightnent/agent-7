# F13: Manus Project & Agent Personality

**Date**: 2026-02-16
**Status**: Draft
**Depends on**: F12 (admin console + DB-backed config — complete)

## Problem Statement

1. **No task organization in Manus** — every task agent-7 creates is a standalone item. There's no project grouping, no shared instructions across tasks, and no way to give Manus persistent context about the user.
2. **No personality** — agent-7's WhatsApp responses are hardcoded templates (`Got it - working on "{title}" now.`). There's no consistent tone, no user-aware framing, and no way to customize how the agent communicates.
3. **Soul ≠ task instructions** — the personality of agent-7 on WhatsApp (tone, boundaries, communication style) and the instructions for Manus task execution (user context, preferences, work style) serve different purposes and need to be independently tunable.

## Goal

Add two new configurable text fields:

1. **Manus project instructions** — persistent context sent to every Manus task via a project. Covers: who the user is, their preferences, how tasks should be approached.
2. **Agent personality** — governs how agent-7 itself communicates on WhatsApp. Covers: tone, verbosity, proactive behaviour rules, boundaries.

Both are editable via the admin console UI and stored in the database.

## Design Principles

1. **Two fields, two concerns**: Manus instructions optimize task execution. Agent personality optimizes the WhatsApp experience. They can reference each other but are edited independently.
2. **Markdown-native**: Both fields are authored and stored as markdown. The UI renders them as formatted markdown for readability.
3. **Progressive enhancement**: The system works without either field configured — it falls back to current behaviour (template acks, no project grouping). Personality and instructions are additive.

---

## Architecture

### New settings

Two new entries in `workspace_settings`, both under new categories:

| Category | Key | Sensitive | Purpose |
|---|---|---|---|
| `manus` | `project_id` | no | Manus project ID, auto-created during setup |
| `manus` | `project_instructions` | no | Markdown text injected as Manus project instructions |
| `agent` | `personality` | no | Markdown text defining agent-7's WhatsApp personality (the "soul") |

The `agent` category is new. This keeps the personality separate from Manus-specific config and leaves room for future agent-level settings (memory, heartbeat config, etc.).

### Manus project lifecycle

```
Setup flow:
1. User saves Manus API key (existing)
2. System calls Manus "Create Project" API:
   - name: "Agent-7"
   - instructions: value of manus.project_instructions (or empty)
3. Store returned project_id in workspace_settings (manus.project_id)
4. All future createTask calls include projectId from settings

On instructions update:
1. User edits project_instructions in UI
2. Save to workspace_settings
3. Call Manus "Update Project" API to sync instructions to the existing project
```

### Agent personality injection points

The personality text is injected into agent-7's own LLM calls. Currently there are two LLM touchpoints — the task router classifier and the ack/delivery text. The personality applies to:

| Touchpoint | Current behaviour | With personality |
|---|---|---|
| **Task acknowledgment** | Template: `Got it - working on "{title}" now.` | LLM generates ack using personality + task context |
| **Result delivery** | Forward Manus output as-is | LLM wraps Manus output with personality-aware framing |
| **Task router** | System prompt: "You are a message router..." | Unchanged — routing is functional, not conversational |

The personality is NOT injected into the Manus task prompt. Manus gets its own instructions via the project.

### How the two fields relate

```
┌─────────────────────────────────────────┐
│  User's WhatsApp message                │
│                                         │
│  ┌───────────────────────────────┐      │
│  │  Agent-7 orchestration layer  │      │
│  │  Uses: agent.personality      │◄──── Agent personality governs
│  │  - ack tone & phrasing        │      tone of WhatsApp replies
│  │  - result delivery framing    │      │
│  │  - proactive message style    │      │
│  └──────────┬────────────────────┘      │
│             │                           │
│             │ createTask(prompt,        │
│             │   projectId)              │
│             ▼                           │
│  ┌───────────────────────────────┐      │
│  │  Manus execution layer        │      │
│  │  Uses: manus.project_instructions ◄── Project instructions govern
│  │  - user context & preferences │      how Manus approaches tasks
│  │  - work style guidance        │      │
│  │  - domain knowledge           │      │
│  └───────────────────────────────┘      │
└─────────────────────────────────────────┘
```

---

## UI Design

### Manus project instructions — in existing Manus config section (`/config`)

The existing Manus settings card gains a new field:

- **Label**: "Project Instructions"
- **Display**: Read-only markdown-rendered preview (truncated to ~4 lines with fade)
- **Edit action**: "Edit" button opens a **full-screen modal** with:
  - Left pane: raw markdown textarea (monospace font, full height)
  - Right pane: live markdown preview (rendered, scrollable)
  - Or: single pane with a "Preview" toggle tab if split-pane is too complex for v1
  - Bottom: "Save" and "Cancel" buttons
  - Save triggers: PUT to settings API + Manus Update Project API call
- **Empty state**: Placeholder text: *"No project instructions configured. Add context about yourself and your preferences to help Manus produce better results."*
- **Help text below field**: *"These instructions are sent to Manus with every task. Include information about yourself, your work context, preferred tools, and how you'd like tasks approached."*

### Agent personality — new section on `/config` page

A new card/section titled **"Agent Personality"**, placed below the existing config categories (or as a new top-level section above Manus):

- **Label**: "Personality"
- **Display**: Read-only markdown-rendered preview (truncated to ~4 lines with fade)
- **Edit action**: Same modal pattern as project instructions — "Edit" button opens full-screen modal with markdown editor + preview
- **Empty state**: Placeholder text: *"No personality configured. Agent-7 will use default template responses."*
- **Help text below field**: *"Defines how Agent-7 communicates with you on WhatsApp — tone, verbosity, boundaries. Does not affect how Manus executes tasks."*

### Modal component (shared)

Both fields use the same modal component:

```
┌──────────────────────────────────────────────────┐
│  Edit Project Instructions              [✕ Close]│
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────┐ ┌────────────────────────┐ │
│  │ # Instructions   │ │ Instructions           │ │
│  │                  │ │                        │ │
│  │ You are working  │ │ You are working for    │ │
│  │ for Mike, a...   │ │ Mike, a...             │ │
│  │                  │ │                        │ │
│  │ ## Preferences   │ │ Preferences            │ │
│  │ - TypeScript     │ │ • TypeScript           │ │
│  │ - Concise code   │ │ • Concise code         │ │
│  │                  │ │                        │ │
│  │  [Raw Markdown]  │ │  [Live Preview]        │ │
│  └──────────────────┘ └────────────────────────┘ │
│                                                  │
│                          [ Cancel ]  [ Save ]    │
└──────────────────────────────────────────────────┘
```

- Modal should be large — at least 80% viewport width, 80% viewport height
- Markdown preview uses the same renderer as the read-only display on the config page
- Textarea should support tab indentation and have comfortable line height

---

## Implementation

### Phase 1: DB + settings catalog

**Scope**:
- Add `project_instructions` to manus settings category in `settings-catalog.ts`
- Add new `agent` settings category with `personality` key
- No migration needed — `workspace_settings` is key-value, new keys just get inserted on first save

**Deliverables**:
- `src/lib/config/settings-catalog.ts` — add new entries
- `src/lib/env.ts` — add Zod fields for new settings (optional strings, default empty)

**Success criteria**:
- `GET /api/settings/manus` returns `project_instructions` field
- `GET /api/settings/agent` returns `personality` field
- `PUT /api/settings/manus` can save `project_instructions`
- `PUT /api/settings/agent` can save `personality`

### Phase 2: Manus project auto-creation

**Scope**:
- Add `createProject` and `updateProject` methods to `ManusClient`
- On first task creation (or explicit setup action), if `manus.project_id` is not set:
  1. Call Manus Create Project API (name: "Agent-7", instructions: current `project_instructions` value)
  2. Save returned `project_id` to `workspace_settings`
- Pass `projectId` in all `createTask` calls
- When `project_instructions` is updated via UI, call Manus Update Project API to sync

**Deliverables**:
- `src/lib/manus/client.ts` — add `createProject()`, `updateProject()` methods
- `src/lib/orchestration/task-creation.ts` — read `projectId` from settings, pass to `createTask`
- API route for instructions save — trigger project update after DB write

**Success criteria**:
- First task creation auto-creates a Manus project and stores the ID
- All subsequent tasks appear under that project in Manus
- Editing project instructions in UI syncs to Manus project

### Phase 3: Agent personality injection

**Scope**:
- Read `agent.personality` from settings at task ack and result delivery time
- Replace hardcoded `buildAckText` with a small LLM call (using existing router LLM config) that takes personality + task title → generates ack
- Add personality-aware result framing when delivering Manus output back to WhatsApp
- Graceful fallback: if personality is empty or LLM call fails, use current template behaviour

**Deliverables**:
- `src/lib/orchestration/task-creation.ts` — personality-aware ack generation
- `src/lib/orchestration/manus-webhook-handler.ts` — personality-aware result delivery
- Shared utility for loading personality from settings

**Success criteria**:
- With personality configured: acks and result deliveries reflect the configured tone
- Without personality configured: behaviour identical to current templates
- LLM failure: falls back to templates, no user-facing error

### Phase 4: Admin console UI

**Scope**:
- Markdown editor modal component (shared between both fields)
- Add "Project Instructions" field to Manus config card with edit modal
- Add new "Agent Personality" section/card to config page with edit modal
- Markdown preview rendering (use `react-markdown` or similar)
- Wire save actions to settings API

**Deliverables**:
- `src/components/markdown-editor-modal.tsx` — reusable modal with textarea + markdown preview
- `src/app/(dashboard)/config/settings-editor.tsx` — add project instructions to Manus card, add Agent Personality section
- API integration for save + Manus project sync

**Success criteria**:
- Both fields display markdown preview on config page
- Edit modal opens with current content, renders live preview
- Save persists to DB and (for instructions) syncs to Manus
- Empty state shows helpful placeholder text
- Modal is comfortable to use for multi-paragraph markdown content

---

## Example content

### Example: Project Instructions (manus.project_instructions)

```markdown
# About the user

Mike is a software engineer based in Singapore (SGT timezone).
He works on side projects and AI agent tooling.

## Preferences

- Always use TypeScript (never plain JS)
- Prefer simple, pragmatic solutions over clever ones
- When writing code, include brief inline comments for non-obvious logic
- Default to Next.js App Router patterns

## Context

- "Agent-7" is Mike's WhatsApp AI assistant project
- Tech stack: Next.js, Drizzle ORM, Neon Postgres, Vercel
- Manus is used as the task execution backend
```

### Example: Agent Personality (agent.personality)

```markdown
# Agent-7

You are Agent-7, Mike's personal AI operator on WhatsApp.

## Tone
- Direct and concise. No corporate fluff.
- Casual but competent — like a sharp colleague, not a customer service bot.
- Use plain language. No emoji unless the user does first.

## Communication rules
- Keep acknowledgments to one sentence.
- When delivering results, lead with the answer. Add context after if needed.
- If a task fails, say what went wrong plainly. Don't apologize excessively.
- Respect the user's time — don't over-communicate.

## Boundaries
- Never send messages to group chats without explicit permission.
- Don't speculate about task progress — only report what you know.
```

---

## What this does NOT cover (future work)

| Concern | Why deferred |
|---|---|
| LLM-powered ack/delivery (Phase 3) could use a dedicated small model | Start with the existing router LLM config. Optimize later if latency is an issue. |
| Memory system (cross-session recall) | Separate feature — see learnings doc Phase 2. |
| Heartbeat / proactive messages | Separate feature — see learnings doc Phase 3. Personality will apply to those when built. |
| Per-task instruction overrides | Start with project-level only. Per-task overrides add complexity without clear need yet. |
