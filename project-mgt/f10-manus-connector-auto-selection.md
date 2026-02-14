# F10: Manus Connector Auto-Selection for Task Creation/Continue

## Background

In `agent-7`, Manus tasks are isolated. Connector access is not implicitly inherited by conversation context.  
To use a connector (for example ClickUp), connector IDs must be passed in the `connectors` array on each relevant API call.

Current user-facing failure mode:

1. User asks a connector-dependent question (example: "check outstanding tasks in ClickUp").
2. Assistant does not include connector in Manus API request.
3. Task executes without connector context and assistant asks for alternate access methods (API token/web login), even though the connector is already connected in Manus.

## Root Cause

Connector support exists in code, but connector resolution/injection is missing from orchestration.

- `src/lib/manus/client.ts` supports `connectors?: string[]`.
- `src/lib/orchestration/task-creation.ts` does not resolve/pass connectors on `createTask`.
- `src/lib/orchestration/inbound-dispatch.ts` does not resolve/pass connectors on `continueTask`.
- Router currently decides only `continue` vs `new`; it has no connector selection step.

## New Design Direction

Use Manus connector catalog as canonical source, then resolve only against user-enabled connectors.

### 1) Connector Catalog Service

- Source canonical connectors (`uid`, `name`) from Manus connector catalog endpoint/documented source.
- Cache results with TTL.
- Build normalized alias index from connector names (case-insensitive, spacing-insensitive).

### 2) Supported vs Enabled

- Supported connectors: all from Manus catalog.
- Enabled connectors: those connected for this account/user/workspace.
- Auto-selection must only choose from enabled connectors.

### 3) Connector Resolver

Given inbound message + session context:

- Match explicit mentions against enabled connector aliases.
- Apply lightweight fuzzy/token scoring when exact match fails.
- Reuse last confirmed connector(s) for follow-up turns unless switch intent is detected.
- Return:
  - `connectorUids: string[]`
  - `confidence: number`
  - `reason: string`
  - `source: rule | memory | manual_alias`

### 4) Orchestration Injection

Use resolver output for both paths:

- New task creation (`createTask`) includes `connectors`.
- Continue task (`continueTask`) includes `connectors`.

This ensures connector availability is consistent across turns and task lifecycle.

### 5) Ambiguity Handling

- Single high-confidence match: auto-apply connector.
- Multiple close matches: ask brief disambiguation.
- No match: ask which connector to use.

## Edge Case: Custom MCP Connectors (Not in Manus Catalog)

Users may have custom MCP connectors that are not in public Manus catalog data.

Minimal support to include now:

- Add `manualConnectorAliases` map (config or DB) of alias -> connector UID.
- Resolver precedence:
  1. manual aliases (custom MCP support)
  2. catalog aliases
  3. session memory fallback

This keeps implementation simple while avoiding a hard blocker for custom connectors.

## Data and Observability Additions

Capture connector resolution metadata for diagnostics:

- `resolved_connectors`
- `resolver_confidence`
- `resolver_reason`
- `resolver_source`

Optional: persist per-session connector memory (`last_confirmed_connector_uids`).

## Proposed Phases

### Phase 1 (now)

1. Add connector catalog service + cache.
2. Add resolver (rule + fuzzy + memory).
3. Inject connectors into create/continue task calls.
4. Add manual alias override support for custom MCP.
5. Add tests for explicit mention, follow-up reuse, ambiguity, and no-match flows.

### Phase 2 (later)

1. Improve enabled-connector discovery if dedicated API becomes available.
2. Add retry-on-stale-connector behavior (catalog refresh + retry once).
3. Add richer intent-switch detection between tools.

## Acceptance Criteria

- Connector-explicit asks (e.g., "use ClickUp connector") include correct connector UID in Manus API call.
- Follow-up asks in same context reuse connector without re-prompting.
- Ambiguous asks trigger concise clarification instead of silent misrouting.
- Custom connector aliases can be configured without code changes.
