> **Note:** This is the original design spec for safety hardening. All 5 features have been implemented in v0.14.0. Current metrics: 36 MCP tools, 230 tests across 27 files.

# Safety Hardening Spec — superhuman-cli

## Context

superhuman-cli is a 34-tool MCP server that controls a real email account. The most dangerous operations (send, reply, reply-all, forward) are currently marked `destructiveHint: false` and execute with zero confirmation. Delete and archive — which are *less* dangerous — are the only tools gated. A malfunctioning agent could send email to the wrong person, mass-delete from the wrong account, or trigger actions through Superhuman's built-in AI proxy, all with no safety net beyond a 20-second send delay.

This spec adds five layers of defense: dry-run preview, corrected MCP annotations, server-enforced two-phase commit with batch-aware manifests, a mutation audit log, and a kill switch.

---

## 1. Dry-Run Flag (Convenience Preview)

**What:** Add optional `dryRun?: boolean` to every mutating tool's Zod schema.

**Behavior:** When `true`, the handler validates inputs, resolves what would happen (fetches thread metadata for delete/archive, echoes composed message for sends), and returns a structured preview. No mutation occurs.

**Affected tools (all mutating tools):**
- `superhuman_send`, `superhuman_reply`, `superhuman_reply_all`, `superhuman_forward`
- `superhuman_draft` (low risk, but include for symmetry)
- `superhuman_archive`, `superhuman_delete`
- `superhuman_calendar_create`, `superhuman_calendar_update`, `superhuman_calendar_delete`
- `superhuman_use_snippet` (when `send: true`)
- `superhuman_mark_read`, `superhuman_mark_unread`, `superhuman_star`, `superhuman_unstar`
- `superhuman_add_label`, `superhuman_remove_label`
- `superhuman_snooze`, `superhuman_unsnooze`
- `superhuman_switch_account`
- `superhuman_ask_ai`

**Not a safety mechanism.** The agent can omit it. This exists for intentional previewing by a well-behaved caller.

**CLI equivalent:** `--dry-run` global flag, checked at the top of each `cmd*()` handler in `src/cli.ts`.

**Files to modify:**
- Every schema in `src/mcp/tools/email-write.ts`, `email-manage.ts`, `calendar.ts`, `snippets.ts`, `ai.ts`, `accounts.ts`, `labels.ts`, `snooze.ts`
- Every corresponding handler (early return with preview string)
- `src/cli.ts` — add `--dry-run` to arg parser, check in each cmd function

---

## 2. Fix MCP Annotations (Client-Enforced Gating)

**What:** Correct `destructiveHint` on tools whose current annotation understates their risk.

**Changes to `src/mcp/server.ts`:**

| Tool | Current | New | Rationale |
|------|---------|-----|-----------|
| `superhuman_send` | `false` | **`true`** | Sends real email, irreversible after delay |
| `superhuman_reply` | `false` | **`true`** | Can send with `send: true` |
| `superhuman_reply_all` | `false` | **`true`** | Blast radius — sends to all recipients |
| `superhuman_forward` | `false` | **`true`** | Data leaves your control |
| `superhuman_use_snippet` | *not set* | **`true`** | Can send with `send: true` |
| `superhuman_ask_ai` | *not set* | **`true`** | Backend AI can trigger sends/drafts |
| `superhuman_switch_account` | *not set* | **`true`** | Silently retargets all subsequent ops |
| `superhuman_calendar_create` | `false` | **`true`** | Creates real events, notifies attendees |
| `superhuman_calendar_update` | `false` | **`true`** | Modifies events, can change attendees |
| `superhuman_archive` | `true` | `true` | No change (already correct) |
| `superhuman_delete` | `true` | `true` | No change (already correct) |
| `superhuman_calendar_delete` | `true` | `true` | No change (already correct) |

**Effect:** Claude Code (and other compliant MCP clients) will prompt the user before invoking these tools.

**Limitation:** Advisory only. Non-compliant clients can ignore the hint. Level 3 addresses this.

---

## 3. Two-Phase Commit (Server-Enforced Gating)

### 3a. Core Mechanism

**What:** Destructive operations no longer execute on first call. They stage the operation and return a confirmation token. A second call to `superhuman_confirm` with that token executes.

**New tool:** `superhuman_confirm`
```typescript
const ConfirmSchema = z.object({
  token: z.string().describe("Confirmation token from a staged operation"),
  force: z.boolean().optional().describe("Required for batch operations exceeding 50 items"),
});
```

**Staged operation flow:**
```
Agent -> superhuman_delete({ threadIds: ["t1", "t2"] })
Server -> stages, returns:
  { isError: false, content: "STAGED -- Would delete 2 thread(s):
    1. t1 -- 'Re: Project kickoff' (from bob@co.com, Mar 5)
    2. t2 -- 'Invoice #4821' (from billing@vendor.com, Mar 3)
    Confirm with token: shm_abc123
    Expires in 120 seconds." }

Agent -> superhuman_confirm({ token: "shm_abc123" })
Server -> executes delete, returns result
```

**Token properties:**
- Format: `shm_<random>` (24-char alphanumeric)
- TTL: 120 seconds (in-memory Map, auto-pruned)
- Bound to exact payload (tool name + serialized args hash)
- Single-use: consumed on confirm, rejected on replay
- Server restart = all tokens expire (safe default)

**Token storage:** In-memory `Map<string, StagedOperation>` in a new `src/mcp/confirmation.ts` module:
```typescript
interface StagedOperation {
  token: string;
  tool: string;
  args: Record<string, unknown>;
  argsHash: string;        // SHA-256 of canonical JSON
  preview: string;         // Human-readable manifest
  createdAt: number;       // Date.now()
  ttlMs: number;           // 120_000
  account: string;         // Active account at staging time
}
```

**Account binding:** The staged operation records the active account. If the account changes between stage and confirm (via `switch_account`), confirm is rejected with an error explaining the mismatch.

### 3b. Which Tools Get Two-Phase Commit

**Tier 1 — Always two-phase (irreversible mutations):**
- `superhuman_send`
- `superhuman_reply` (when `send: true`)
- `superhuman_reply_all` (when `send: true`)
- `superhuman_forward` (when `send: true`)
- `superhuman_delete`
- `superhuman_calendar_delete`
- `superhuman_ask_ai`

**Tier 2 — Two-phase (reversible but impactful):**
- `superhuman_archive`
- `superhuman_calendar_create`
- `superhuman_calendar_update`
- `superhuman_switch_account`
- `superhuman_use_snippet` (when `send: true`)

**Tier 3 — Direct execution (low risk, reversible):**
- `superhuman_draft`
- `superhuman_reply/reply_all/forward` (when `send: false`, i.e. draft mode)
- `superhuman_use_snippet` (when `send: false`)
- `superhuman_mark_read`, `superhuman_mark_unread`
- `superhuman_star`, `superhuman_unstar`
- `superhuman_add_label`, `superhuman_remove_label`
- `superhuman_snooze`, `superhuman_unsnooze`

Tier 3 tools still get audit-logged (Section 4) but execute immediately.

### 3c. Batch Operations — Tiered Preview + Manifest Digest

Batch tools (`archive`, `delete`, `star`, `unstar`, `mark_read`, `mark_unread`, `add_label`, `remove_label`, `snooze`, `unsnooze`) accept `threadIds: string[]`. The staged preview adapts to batch size:

**Preview density tiers:**
| Batch Size | Preview Content |
|---|---|
| 1-5 | Full detail per thread (subject, from, date) |
| 6-20 | Digest summary + full subject list |
| 21-50 | Digest summary + 5-thread sample + count |
| 51+ | Digest summary only + `force: true` required on confirm |

**Manifest digest** (included at all sizes):
```
Digest: 47 threads | oldest: Jan 3 | newest: Mar 6
  44 from spammer@evil.com
  2 from noreply@service.com
  1 from alice@company.com    <-- ANOMALY (only 1 from this sender)
```

The digest groups by sender and flags outliers (senders contributing <5% of the batch) as anomalies. This surfaces mistakes like "you searched for spam but one real email got mixed in."

**`force: true` requirement:**
- Batches >50 items require `superhuman_confirm({ token, force: true })`
- This is a distinct permission signal — Claude Code gates it separately
- Without `force`, confirm is rejected: "Batch exceeds 50 items. Re-confirm with force: true."

**Implementation:** Add a `buildManifest()` helper in `src/mcp/confirmation.ts` that:
1. Takes an array of thread IDs
2. Fetches thread metadata in parallel (subject, from, date) via existing `readThread()`
3. Groups by sender, computes date range
4. Flags anomalous senders
5. Returns tiered preview string + digest string

### 3d. `superhuman_ask_ai` — Special Handling

`ask_ai` proxies to Superhuman's backend AI which can independently decide to send email, create drafts, or modify state. The two-phase commit applies at the *invocation* level:

```
Agent -> superhuman_ask_ai({ query: "Reply to John's email saying I'll be late" })
Server -> stages, returns:
  "STAGED -- Would invoke Superhuman AI with query:
   'Reply to John's email saying I'll be late'
   WARNING: Superhuman AI has skills: draft, filter, schedule, multiMessage.
   This query may trigger real email actions.
   Confirm with token: shm_xyz789"
```

We cannot preview the AI's *output* before it runs — the gate is "should this query be sent to the AI at all."

---

## 4. Mutation Audit Log

**What:** Append-only JSONL log of every mutating tool call, regardless of tier.

**Location:** `~/.config/superhuman-cli/audit.jsonl`
(Same directory as existing `tokens.json`, leveraging `getConfigDir()` from `src/auth/token-store.ts`)

**Log entry schema:**
```typescript
interface AuditEntry {
  timestamp: string;       // ISO 8601
  tool: string;            // e.g. "superhuman_send"
  account: string;         // Active account email
  action: "staged" | "confirmed" | "executed" | "rejected" | "expired" | "killed";
  args: Record<string, unknown>;  // Tool arguments (body truncated to 200 chars)
  token?: string;          // Confirmation token (if two-phase)
  result: "success" | "error" | "dry_run";
  error?: string;          // Error message if failed
  batchSize?: number;      // For batch operations
  dryRun: boolean;
}
```

**What gets logged:**
| Event | `action` value |
|---|---|
| Two-phase tool called, staged | `"staged"` |
| Confirm called, executed | `"confirmed"` |
| Tier 3 tool called, executed directly | `"executed"` |
| Confirm with wrong token / expired | `"rejected"` |
| Token TTL expires without confirm | `"expired"` |
| Kill switch blocked execution | `"killed"` |

**Rotation:** When `audit.jsonl` exceeds 10MB, rename to `audit.jsonl.1` (keep one backup). Simple, no external dependencies.

**Privacy:** Email body content is truncated to 200 characters in log entries. Full recipient lists are logged (needed for forensics). Attachments are logged by filename only, not content.

**Implementation:** New module `src/audit.ts` with:
- `logAudit(entry: AuditEntry): Promise<void>` — appends JSON line + newline
- `readAuditLog(options?: { limit?: number, tool?: string }): Promise<AuditEntry[]>` — for review
- Uses `getConfigDir()` from token-store for path resolution
- File append is async but non-blocking (fire-and-forget with error swallow — audit failure must never block operations)

**New MCP tool** (read-only): `superhuman_audit_log`
```typescript
const AuditLogSchema = z.object({
  limit: z.number().optional().describe("Number of recent entries to return (default: 50)"),
  tool: z.string().optional().describe("Filter to a specific tool name"),
});
```

---

## 5. Kill Switch

**What:** A sentinel file that, when present, causes all mutating operations to refuse execution immediately.

**Location:** `~/.config/superhuman-cli/kill-switch`

**Mechanism:**
- If the file exists, every mutating handler returns an error: `"KILLED -- All mutating operations are suspended. Remove ~/.config/superhuman-cli/kill-switch to resume."`
- Checked *synchronously* via `fs.existsSync()` at the top of every mutating handler, before any network calls
- Also checked before `superhuman_confirm` executes — staged tokens cannot be confirmed while killed
- Read-only tools (`inbox`, `search`, `read`, `accounts`, `labels`, `starred`, `snoozed`, `snippets`, `attachments`, `calendar_list`, `calendar_free_busy`, `audit_log`) continue working normally

**Activation:**
```bash
# Activate kill switch (immediate, any terminal)
touch ~/.config/superhuman-cli/kill-switch

# Deactivate
rm ~/.config/superhuman-cli/kill-switch
```

**Optional file content:** If the file contains text, that text is included in the error message:
```
"KILLED -- Reason: 'investigating suspicious batch delete at 14:32'
 Remove ~/.config/superhuman-cli/kill-switch to resume."
```

**CLI integration:** Two new CLI commands:
```bash
bun run src/cli.ts kill                      # creates kill-switch file
bun run src/cli.ts kill "investigating bug"  # creates with reason
bun run src/cli.ts unkill                    # removes kill-switch file
```

**Audit interaction:** Kill switch activation/deactivation is logged to the audit log.

**Implementation:** New module `src/kill-switch.ts` with:
- `isKilled(): { killed: boolean; reason?: string }` — sync check
- `activate(reason?: string): void`
- `deactivate(): void`
- Guard function `assertNotKilled(): void` — throws if killed (called at top of every mutating handler)

Helper in `src/mcp/tools/shared.ts`:
```typescript
export function guardMutation(): ToolResult | null {
  const { killed, reason } = isKilled();
  if (killed) {
    return errorResult(`KILLED -- ${reason || "All mutations suspended."}
Remove kill-switch file to resume.`);
  }
  return null;  // safe to proceed
}
```

Every mutating handler gets a 2-line guard at the top:
```typescript
const killed = guardMutation();
if (killed) return killed;
```

---

## Implementation Order

1. **Kill switch** (`src/kill-switch.ts`, `shared.ts` guard, CLI commands) — smallest change, immediate value as a panic button
2. **Audit log** (`src/audit.ts`, `superhuman_audit_log` tool) — adds visibility before changing behavior
3. **Fix annotations** (`src/mcp/server.ts`) — one-line changes, immediate client-side gating
4. **Two-phase commit** (`src/mcp/confirmation.ts`, handler refactors, `superhuman_confirm` tool) — largest change, depends on audit log for logging staged/confirmed/expired events
5. **Dry-run** (schema + handler changes) — depends on two-phase infrastructure for preview generation (reuses `buildManifest()`)

---

## Verification

- **Kill switch:** `touch` the file, call any mutating tool, verify refusal. Remove, verify resumption. Check audit log for entries.
- **Audit log:** Call several tools, read `audit.jsonl`, verify entries. Call `superhuman_audit_log` via MCP. Test rotation at 10MB.
- **Annotations:** Connect via Claude Code, call `superhuman_send` — verify Claude Code prompts for confirmation.
- **Two-phase commit:** Call `superhuman_delete` — verify staged response with preview. Call `superhuman_confirm` with correct token — verify execution. Test: expired token, wrong token, account mismatch, batch >50 without `force`.
- **Dry-run:** Call `superhuman_delete --dry-run` via CLI and `{ dryRun: true }` via MCP — verify preview without mutation. Verify no audit log entry with `action: "executed"`.
- **Batch manifests:** Delete 3, 15, 30, and 60 threads — verify preview density matches tier. Verify anomaly flagging with a mixed-sender batch.
- **End-to-end:** Agent session: search spam, stage batch delete, verify manifest shows anomaly, confirm, verify audit log, activate kill switch, attempt send, verify refusal.
- **Existing tests:** `bun test` must still pass (143 tests). `bunx tsc --noEmit` must show 0 errors.

---

## Files to Create
- `src/kill-switch.ts` — kill switch module
- `src/audit.ts` — audit log module
- `src/mcp/confirmation.ts` — two-phase commit (token store, staging, manifest builder)
- `src/mcp/tools/confirm.ts` — `superhuman_confirm` handler
- `src/mcp/tools/audit.ts` — `superhuman_audit_log` handler

## Files to Modify
- `src/mcp/server.ts` — fix annotations, register new tools (`confirm`, `audit_log`)
- `src/mcp/tools/shared.ts` — add `guardMutation()` helper
- `src/mcp/tools/email-write.ts` — add dry-run, two-phase staging, audit logging, kill switch guard
- `src/mcp/tools/email-manage.ts` — add dry-run, two-phase staging, audit logging, kill switch guard
- `src/mcp/tools/calendar.ts` — add dry-run, two-phase staging, audit logging, kill switch guard
- `src/mcp/tools/snippets.ts` — add dry-run, two-phase staging (send=true), audit logging, kill switch guard
- `src/mcp/tools/ai.ts` — add two-phase staging, audit logging, kill switch guard
- `src/mcp/tools/accounts.ts` — add two-phase staging for switch, audit logging, kill switch guard
- `src/mcp/tools/labels.ts` — add dry-run, audit logging, kill switch guard
- `src/mcp/tools/snooze.ts` — add dry-run, audit logging, kill switch guard
- `src/cli.ts` — add `--dry-run` flag, `kill`/`unkill` commands
