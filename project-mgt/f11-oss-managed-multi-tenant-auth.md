# F11: OSS Core + Managed SaaS Authn/Authz (Multi-User Enterprise)

**Date**: 2026-02-15  
**Status**: OSS Phase 1 Complete; Managed Phases Pending

## Implementation Status (2026-02-15)

Phase 1 is implemented for OSS mode in this repository:

- Added `workspaces` table and default workspace seed migration.
- Added `workspace_id` to:
  - `channel_sessions`
  - `messages`
  - `manus_tasks`
  - `manus_webhook_events`
  - `manus_attachments`
- Updated core store reads/writes to use default workspace scope.
- Generated migration: `drizzle/0001_nice_miss_america.sql`.

Managed authn/authz phases (principals, memberships, permissions, service keys, Cognito flows) remain planned below.

## Goal

Keep the open-source codebase auth-agnostic and highly extensible, while offering a managed SaaS layer that adds:

- Multi-user access
- SSO (enterprise IdPs)
- RBAC
- Tenant/workspace isolation
- Programmatic access (API keys/service principals)
- Auditability

## Product Split

### OSS Distribution

- No required login.
- Seeded `default` workspace.
- Authorization defaults to permissive policy.
- Same orchestration/runtime code paths as managed mode.

### Managed Distribution

- Cognito-backed authentication (Hosted UI + enterprise SSO federation).
- Application-owned authorization (memberships + permissions in app DB).
- Workspace-scoped data boundaries for every tenant.
- Human and programmatic auth paths.

## Core Design Decision

Do **not** add `user_id` to every domain table.

Instead:

1. Scope data by `workspace_id` (or `tenant_id`) at ownership boundaries.
2. Add `created_by_principal_id` / `updated_by_principal_id` where auditability matters.
3. Keep external channel identities (`channel_user_id`) separate from SaaS principals.

Rationale:

- `user_id` everywhere over-couples domain data to one auth model.
- Workspace scoping supports teams, service accounts, bots, and ownership transfer.
- Identity providers can change without domain schema churn.

## Conceptual Model

```text
workspace = data boundary (customer/account)
principal = actor (human user or service account)
principal_identity = external login identity (Cognito/Okta/etc) mapped to principal
workspace_membership = principal's role(s) and status in a workspace
```

## Proposed Identity + Authorization Model

### Core Tables

1. `workspaces`
   - `id` (uuid pk)
   - `slug` (unique)
   - `name`
   - `plan_tier`
   - `status`
   - `created_at`, `updated_at`

2. `principals`
   - `id` (uuid pk)
   - `type` (`user`, `service`)
   - `display_name`
   - `primary_email` (nullable for service principals)
   - `status`
   - `created_at`, `updated_at`

3. `principal_identities`
   - `id` (uuid pk)
   - `principal_id` (fk -> principals.id)
   - `provider` (`cognito`, `google`, `azuread`, `okta`, etc.)
   - `provider_subject` (OIDC/SAML subject)
   - `issuer` (IdP issuer URI/string)
   - `email` (nullable)
   - `email_verified` (bool)
   - `linked_at`
   - unique (`provider`, `provider_subject`)

4. `workspace_memberships`
   - `workspace_id` (fk -> workspaces.id)
   - `principal_id` (fk -> principals.id)
   - `status` (`active`, `invited`, `suspended`)
   - `created_at`, `updated_at`
   - unique (`workspace_id`, `principal_id`)

### Permission Model (Non-Optional)

5. `permissions`
   - `key` (pk), e.g. `tasks.create`, `tasks.continue`, `sessions.read`, `settings.manage`

6. `roles`
   - `id` (uuid pk)
   - `workspace_id` (nullable for global/system roles)
   - `name`
   - `is_system`
   - unique (`workspace_id`, `name`)

7. `role_permissions`
   - `role_id` (fk -> roles.id)
   - `permission_key` (fk -> permissions.key)
   - unique (`role_id`, `permission_key`)

8. `membership_roles`
   - `workspace_id`
   - `principal_id`
   - `role_id`
   - unique (`workspace_id`, `principal_id`, `role_id`)

### Programmatic Access

9. `principal_api_keys`
   - `id` (uuid pk)
   - `principal_id` (fk -> principals.id, typically `type=service`)
   - `workspace_id` (fk -> workspaces.id)
   - `name`
   - `key_prefix` (for display)
   - `key_hash` (argon2/bcrypt hash, never store raw key)
   - `expires_at`, `last_used_at`, `revoked_at`
   - optional `scopes_json`

## Existing Schema Changes (Current Repo)

Current tables live in `src/db/schema.ts`.

### Required v1 Changes

1. `channel_sessions`
   - Add `workspace_id` (not null, fk -> `workspaces.id`)
   - Keep `channel_user_id` as external channel identifier
   - Update unique index to: (`workspace_id`, `channel`, `channel_chat_id`, `channel_user_id`)

2. `messages`
   - Add `workspace_id` (not null, fk -> `workspaces.id`) in v1 (not deferred)
   - Add index (`workspace_id`, `session_id`, `created_at`)
   - Keep `session_id` as referential source of truth

3. `manus_tasks`
   - Add `workspace_id` (not null, fk -> `workspaces.id`)
   - Add index (`workspace_id`, `status`, `updated_at`)
   - Keep `task_id` uniqueness initially; re-scope to workspace if provider behavior requires

4. `manus_webhook_events`
   - Add `workspace_id` (not null, fk -> `workspaces.id`)
   - Index (`workspace_id`, `task_id`, `received_at`)

5. `manus_attachments`
   - Add `workspace_id` (not null, fk -> `workspaces.id`)
   - Index (`workspace_id`, `task_id`)

## Runtime/Auth Boundaries

Create an auth boundary in code, not scattered checks in handlers:

- `AuthProvider`: resolves actor/session (`principal_id`, active `workspace_id`, auth method).
- `Authorizer`: checks permission keys against role bindings and key scopes.
- `TenantContext`: canonical workspace scope object used by repositories/queries.

OSS mode:

- `AuthProvider` returns system/default actor + `default` workspace.
- `Authorizer` allow-all policy.

Managed mode:

- `AuthProvider` supports:
  - browser sessions (Cognito -> app session)
  - API key auth (service principal)
- `Authorizer` enforces permission checks before sensitive reads/writes.

## Session and Token Model

Browser (human users):

- Use `iron-session` HTTP-only cookie for app session.
- Session payload: `principal_id`, `active_workspace_id`, `session_version`, `auth_method`.
- Cognito access/refresh tokens stored encrypted at rest when persistence is needed.
- Workspace switch endpoint validates membership then re-issues session with new `active_workspace_id`.

Programmatic (services/integrations):

- API key via `Authorization: Bearer <key>`.
- Resolve by key prefix, verify against `key_hash`, ensure not revoked/expired.
- Bind request to key's `workspace_id` and principal permissions.

## Cross-Workspace Membership Model

- A principal may belong to multiple workspaces.
- A request/session has exactly one active workspace context.
- Switching workspace is explicit (UI control + API endpoint), never implicit.
- All domain queries and writes must include active `workspace_id`.

## Cognito Scope (Managed)

Use Cognito for **authentication and federation only**:

- Hosted UI login/logout/callback
- Enterprise SSO federation (SAML/OIDC providers)
- Token verification (JWKS)

Keep these in app DB:

- Memberships
- Roles/permissions
- API keys
- Cross-workspace access control
- Audit linkage

## Identity Linking and Trust Rules

1. Primary lookup by (`provider`, `provider_subject`).
2. Email-based linking allowed only when:
   - `email_verified=true` from trusted issuer policy, and
   - no conflicting existing identity mapping.
3. Never auto-link by unverified email.
4. First login for unknown identity creates or queues principal link based on trust policy.

## Abuse and Rate-Limit Boundaries

Add workspace-aware controls at runtime:

- per-workspace request/task creation limits
- per-principal limits inside workspace
- per-API-key limits
- circuit breakers for webhook/task fan-out

These limits should be observable and configurable by plan tier.

## Audit Event Schema (Defined Early)

Create append-only `audit_events`:

- `id` (uuid pk)
- `workspace_id`
- `principal_id` (nullable for system events)
- `action` (e.g. `membership.invited`, `task.force_stop`, `api_key.created`)
- `resource_type`, `resource_id`
- `request_id`
- `ip_address`, `user_agent`
- `before_json`, `after_json` (optional deltas)
- `created_at`

## Migration Plan

### Phase 1: Tenant Skeleton (No Login Required)

1. Add `workspaces` table and seed `default`.
2. Add `workspace_id` to all scoped domain tables:
   - `channel_sessions`, `messages`, `manus_tasks`, `manus_webhook_events`, `manus_attachments`
3. Backfill existing data to `default`.
4. Update all repositories/queries to require workspace scope.
5. Keep existing internal-token API behavior for now.
6. Add basic workspace-scoped rate-limiting keys in runtime.

Success criteria:

- Existing behavior unchanged in OSS/dev mode.
- Every domain read/write is workspace-scoped.

### Phase 2: Principals, Memberships, Permissions, Service Keys

1. Add identity/authz tables:
   - `principals`, `principal_identities`, `workspace_memberships`
   - `permissions`, `roles`, `role_permissions`, `membership_roles`
   - `principal_api_keys`
2. Seed system roles and default permissions.
3. Introduce `AuthProvider` + `Authorizer` interfaces in code with OSS and managed adapters.
4. Add audit event writes for identity/admin operations.

Success criteria:

- Permission checks operate from DB role bindings.
- Service principal/API key auth works for scoped endpoints.

### Phase 3: Cognito Integration (Managed Mode)

1. Add login/exchange/me/logout and workspace-switch endpoints.
2. On login, upsert principal + identity using trust rules.
3. Issue `iron-session` cookie with active workspace context.
4. Enforce middleware/proxy checks for managed routes.

Success criteria:

- Multi-user workspace access functional with SSO and RBAC.
- Multi-workspace users can switch context safely.

### Phase 4: Hardening and Self-Service

1. Add invitation/admin UI and APIs.
2. Add custom workspace role management (non-system roles).
3. Expand audit coverage and retention policies.
4. Optionally add Postgres RLS for defense-in-depth.

## OSS Extensibility Rules

1. Domain services must accept `actor + workspace` context.
2. Domain tables must never depend on Cognito-specific identifiers.
3. Provider identity mapping lives only in identity tables.
4. Auth remains optional via `AUTH_MODE=none|managed`.
5. OSS path always runs with seeded `default` workspace.

## Recommended Immediate Next Step

Implement Phase 1 first (workspace scoping + `messages.workspace_id`) before login/SSO.  
This keeps OSS simple while preventing expensive retrofits in high-volume tables later.
