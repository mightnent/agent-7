# F9: Runtime Stabilization + Webhook Delivery Reliability

**Date**: 2026-02-14  
**Status**: Completed

## Context

After F8 setup/targeting, inbound pairing and acknowledgements were working, but completion replies intermittently failed to arrive on WhatsApp. Root causes were spread across routing, webhook delivery setup, and runtime adapter visibility between server contexts.

## Symptoms Observed

1. Self-chat inbound accepted and persisted, but no Manus task created in some runs.
2. Tasks stuck in `pending` with empty `manus_webhook_events`.
3. Webhook callbacks reached route (`200 accepted`) and task marked `completed`, but no WhatsApp completion message delivered.
4. Continue flow failed with Manus 404 (`task not found or does not belong to user`) for stale local task IDs.

## Root Causes

1. Router LLM payload used `temperature: 0`, rejected by configured model.
2. Classifier errors were fatal, aborting dispatch.
3. No project script to register webhook; callback registration was manual and error-prone.
4. Path-secret-only callback routing was fragile for non URL-safe secret formats.
5. Webhook processor could run without a live runtime adapter in current process.
6. Bootstrap state could remain `booted=true` while adapter was actually unavailable in process.
7. Very long completion text could fail/silently queue as one oversized outbound payload.
8. Stale local active tasks could trigger invalid continue attempts.
9. Cleanup stale-task logic did not verify provider truth before failing tasks.

## Implemented Fixes

### Routing and Dispatch Hardening

- Removed forced `temperature` from router LLM request payload.
- Added classifier error fallback to deterministic `new` task routing.
- Added continue-task Manus 404 fallback: auto-create new task when continued task is missing remotely.

### Webhook Setup and Delivery

- Added webhook callback handler module and dual routes:
  - `/api/manus/webhook/[secret]`
  - `/api/manus/webhook?secret=...`
- Added webhook registration script:
  - `npm run manus:webhook:register`
- Added `MANUS_WEBHOOK_URL` env support and docs.
- Registration script now auto-normalizes bare tunnel URL to:
  - `/api/manus/webhook?secret=<MANUS_WEBHOOK_SECRET>`

### Runtime Adapter Reliability

- Moved runtime WhatsApp adapter storage to `globalThis` for cross-context visibility.
- Webhook handler now boots Baileys when adapter is unavailable, then retries adapter resolution.
- Bootstrap now recovers from stale `booted=true` + missing adapter state.

### Outbound Completion Reliability

- Added outbound text chunking in WhatsApp adapter (splits long completion content into multiple messages).

### Stale Task Lifecycle Safety

- Reworked cleanup stale-task logic to provider-verified two-phase policy:
  - candidate stale by age
  - recent webhook grace window
  - Manus `getTask` verification before fail
  - hard-fail only for missing task (404) or max-age breach

## Outcome

- Inbound self-chat trigger path works.
- Webhook events are ingested and processed.
- Completion events update task state and are deliverable via WhatsApp.
- Stale/invalid continue targets no longer block user flow.

## Operational Guidance

1. Keep Cloudflare quick tunnel process running while app is live.
2. Re-register webhook only when tunnel URL changes.
3. If callbacks stop:
   - check webhook URL in Manus
   - verify `manus_webhook_events` insertion
   - verify adapter availability logs from webhook handler

