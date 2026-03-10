# Safety Hardening — Implementation Session Init

## Your Task

Implement the safety hardening spec at `specs/safety-hardening.md`. Follow the implementation order exactly: kill switch, audit log, fix annotations, two-phase commit, dry-run.

## Project Essentials

- **Runtime:** Bun (not Node.js). Use `bun test`, `bunx tsc --noEmit`, `bun run src/cli.ts`.
- **Working directory:** `Q:\Claude\Superhuman-Mail-Automation\superhuman-cli`
- **Existing tests:** 143 tests across 22 files — must remain passing after each step.
- **Type safety:** `bunx tsc --noEmit` must report 0 errors after each step.
- **Key insight:** `authFetch` uses `response.text()` + `JSON.parse()`, NOT `.json()` — important for mocking in tests.

## Read These Files First

Before writing any code, read and understand the following files in order:

1. `specs/safety-hardening.md` — the full spec (your blueprint)
2. `src/mcp/tools/shared.ts` — where `guardMutation()` goes; has `successResult()`, `errorResult()`, `actionableError()`, `getMcpProvider()`, `ToolResult` type
3. `src/auth/token-store.ts` — has `getConfigDir()` (line 77) returning `~/.config/superhuman-cli`; has AES-256-GCM encryption patterns; private function, so you'll need to extract or duplicate `getConfigDir()` for use in `kill-switch.ts` and `audit.ts`
4. `src/mcp/server.ts` — all 34 tool registrations with current annotations; this is where you fix `destructiveHint` values and register new tools
5. `src/mcp/tools/email-write.ts` — send/reply/reply-all/forward handlers; most complex two-phase refactor
6. `src/mcp/tools/email-manage.ts` — archive/delete handlers with batch loop pattern
7. `src/mcp/tools/calendar.ts` — calendar create/update/delete handlers
8. `src/mcp/tools/ai.ts` — `askAIHandler`; proxies to Superhuman backend AI with `available_skills`
9. `src/mcp/tools/snippets.ts` — `useSnippetHandler` with `send: true/false` paths
10. `src/mcp/tools/accounts.ts` — `switchAccountHandler`; state-changing
11. `src/mcp/tools/labels.ts` — add/remove label handlers (Tier 3, audit only)
12. `src/mcp/tools/index.ts` — barrel export; add new exports here
13. `src/cli.ts` — CLI entry point; add `kill`/`unkill` commands and `--dry-run` flag

## Implementation Order (one at a time, test between each)

### Step 1: Kill Switch

Create `src/kill-switch.ts`:
- Export `getConfigDir()` (extract from `token-store.ts` or duplicate — it's a 4-line function using `process.env.SUPERHUMAN_CLI_CONFIG_DIR || ~/.config/superhuman-cli`)
- `isKilled(): { killed: boolean; reason?: string }` — sync `fs.existsSync()` check on `~/.config/superhuman-cli/kill-switch`; if exists, read content for optional reason
- `activate(reason?: string): void` — write file (create config dir if needed)
- `deactivate(): void` — remove file

Add `guardMutation()` to `src/mcp/tools/shared.ts`:
```typescript
import { isKilled } from "../../kill-switch";
export function guardMutation(): ToolResult | null {
  const { killed, reason } = isKilled();
  if (killed) return errorResult(`KILLED — ${reason || "All mutations suspended."}\nRemove kill-switch file to resume.`);
  return null;
}
```

Add 2-line guard to top of every mutating handler:
```typescript
const killed = guardMutation();
if (killed) return killed;
```

Mutating handlers are in: `email-write.ts` (5), `email-manage.ts` (8), `calendar.ts` (3), `ai.ts` (1), `snippets.ts` (1), `accounts.ts` (1), `labels.ts` (2), `snooze.ts` (2) = 23 handlers total.

Add `kill`/`unkill` CLI commands in `src/cli.ts`.

Write tests: `src/__tests__/kill-switch.test.ts`.

Run `bun test && bunx tsc --noEmit`.

### Step 2: Audit Log

Create `src/audit.ts`:
- `AuditEntry` interface (see spec)
- `logAudit(entry)` — append JSONL to `~/.config/superhuman-cli/audit.jsonl`; fire-and-forget; rotate at 10MB
- `readAuditLog({ limit?, tool? })` — read + parse + filter

Create `src/mcp/tools/audit.ts` with `AuditLogSchema` and `auditLogHandler`.

Register `superhuman_audit_log` tool in `server.ts` (read-only annotations).

Add `logAudit()` calls to all mutating handlers (after execution, log result).

Export from `src/mcp/tools/index.ts`.

Write tests: `src/__tests__/audit.test.ts`.

Run `bun test && bunx tsc --noEmit`.

### Step 3: Fix Annotations

In `src/mcp/server.ts`, change `destructiveHint` to `true` for: `superhuman_send`, `superhuman_reply`, `superhuman_reply_all`, `superhuman_forward`, `superhuman_use_snippet`, `superhuman_ask_ai`, `superhuman_switch_account`, `superhuman_calendar_create`, `superhuman_calendar_update`.

Run `bun test && bunx tsc --noEmit`.

### Step 4: Two-Phase Commit

Create `src/mcp/confirmation.ts`:
- `StagedOperation` interface
- In-memory `Map<string, StagedOperation>` with TTL pruning
- `stageOperation(tool, args, preview, account): string` — returns token
- `confirmOperation(token, force?): StagedOperation` — validates, consumes, returns staged op; throws on expired/invalid/account-mismatch
- `buildManifest(provider, threadIds): Promise<string>` — fetches metadata, groups by sender, detects anomalies, returns tiered preview

Create `src/mcp/tools/confirm.ts` with `ConfirmSchema` and `confirmHandler`.

Register `superhuman_confirm` tool in `server.ts` (destructiveHint: true).

Refactor Tier 1 and Tier 2 handlers to stage instead of execute. The confirm handler calls the original execution logic.

Pattern for refactoring a handler:
```typescript
// Before (direct execution):
export async function deleteHandler(args) {
  const killed = guardMutation();
  if (killed) return killed;
  // ... execute delete ...
  await logAudit({ action: "executed", ... });
}

// After (two-phase):
export async function deleteHandler(args) {
  const killed = guardMutation();
  if (killed) return killed;
  const preview = await buildManifest(provider, args.threadIds);
  const token = stageOperation("superhuman_delete", args, preview, account);
  await logAudit({ action: "staged", token, ... });
  return successResult(`STAGED — ...\nConfirm with token: ${token}\nExpires in 120 seconds.`);
}

// The actual execution logic moves to a new exported function:
export async function executeDelete(args) { ... }
// Called by confirmHandler after token validation
```

Export from `src/mcp/tools/index.ts`.

Write tests: `src/__tests__/confirmation.test.ts` (token lifecycle, expiry, account mismatch, batch force).

Run `bun test && bunx tsc --noEmit`.

### Step 5: Dry-Run

Add `dryRun?: boolean` to every mutating tool's Zod schema. Check at handler top, before kill switch guard (dry-run should work even when killed — it's read-only).

For two-phase tools: dry-run returns the same preview as staging but without creating a token.
For Tier 3 tools: dry-run returns a preview of what would happen.

Add `--dry-run` flag to CLI arg parser; pass to handlers.

Write tests for dry-run paths.

Run `bun test && bunx tsc --noEmit`.

## Architecture Notes

- `getConfigDir()` is currently private in `token-store.ts`. Either export it from there (preferred — single source of truth) or create a shared `src/config.ts` that both `token-store.ts` and the new modules import from.
- Windows path: `getConfigDir()` uses `process.env.HOME` which is set on Windows via Git Bash / WSL. On native Windows, this is `C:\Users\Shawn`. The config dir will be `C:\Users\Shawn\.config\superhuman-cli\`.
- The `superhuman_confirm` handler needs access to execution functions from multiple tool modules. Create dedicated `execute*()` functions exported alongside handlers, or pass execution callbacks when staging.
- For batch manifest building, `readThread()` (from `email-read.ts` or the underlying API) already returns subject/from/date. Use it, but be mindful of rate limits on large batches — consider parallel fetching with `Promise.all()` capped at 10 concurrent.
- Audit log writes must never throw into the handler. Wrap in try/catch with silent swallow.
- Kill switch check must be synchronous (`fs.existsSync`) — no async gaps between check and execution.

## Test Patterns

Existing tests mock at the provider level. Follow the same pattern:
```typescript
import { mock, test, expect, beforeEach, afterEach } from "bun:test";
```

For kill switch tests, create/remove the sentinel file in a temp directory using `SUPERHUMAN_CLI_CONFIG_DIR` env override.

For audit log tests, use the same env override to write to a temp directory.

For confirmation tests, test the in-memory token store directly — no filesystem needed.
