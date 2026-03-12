# Feature Backlog

## Feature 1: Kill Switch — COMPLETE

**Status:** Complete

**Description:** Sentinel file that immediately suspends all mutating operations when present.

**Implementation:**
- `src/kill-switch.ts` — `isKilled()`, `activate()`, `deactivate()` functions
- `src/mcp/tools/shared.ts` — `guardMutation()` helper called at top of every mutating handler
- `src/cli.ts` — `kill` / `unkill` CLI commands

## Feature 2: Add Superhuman Native Drafts — COMPLETE

**Status:** Complete (SuperhumanDraftProvider implemented with tests)

**Description:** Add SuperhumanDraftProvider to fetch native drafts from `userdata.getThreads` endpoint

**Implementation:**
- `src/providers/superhuman-draft-provider.ts` — SuperhumanDraftProvider class
- `src/__tests__/superhuman-draft-provider.test.ts` — Tests
- Registered in DraftService; native drafts appear via `superhuman draft list`

**API Endpoint:** `POST https://mail.superhuman.com/~backend/v3/userdata.getThreads`
- Request: `{ "filter": { "type": "draft" }, "offset": 0, "limit": 25 }`

## Feature 3: Dry-Run Flag — COMPLETE

**Status:** Complete

**Description:** Optional `dryRun` boolean on every mutating tool's schema. Returns a preview of what would happen without executing any mutation.

**Implementation:**
- `dryRun?: boolean` added to all mutating tool Zod schemas
- Early return with preview string in each handler
- `--dry-run` global flag in `src/cli.ts`

## Feature 4: Two-Phase Commit / Confirmation — COMPLETE

**Status:** Complete

**Description:** Destructive operations stage and return a confirmation token; a second call to `superhuman_confirm` executes.

**Implementation:**
- `src/mcp/confirmation.ts` — token store, `stageOperation()`, `confirmOperation()`, `buildManifest()`
- `src/mcp/tools/confirm.ts` — `superhuman_confirm` tool handler
- Tier 1/2 handlers refactored to stage instead of execute directly

## Feature 5: Mutation Audit Log — COMPLETE

**Status:** Complete

**Description:** Append-only JSONL log of every mutating tool call with rotation at 10MB.

**Implementation:**
- `src/audit.ts` — `logAudit()`, `readAuditLog()` functions
- `src/mcp/tools/audit.ts` — `superhuman_audit_log` read-only MCP tool
- All mutating handlers call `logAudit()` after execution
