/**
 * Two-Phase Commit — server-enforced staging with confirmation tokens.
 *
 * Mutating operations are staged (Tier 1/2) and return a single-use token
 * that must be confirmed via `superhuman_confirm` before execution.
 */

import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StagedOperation {
  token: string;
  tool: string;
  args: Record<string, unknown>;
  argsHash: string;
  preview: string;
  createdAt: number;
  ttlMs: number;
  account: string;
}

// ---------------------------------------------------------------------------
// Token Store (in-memory, auto-pruned)
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 120_000; // 2 minutes
const staged = new Map<string, StagedOperation>();

/** Remove expired tokens. */
function prune(): void {
  const now = Date.now();
  for (const [key, op] of staged) {
    if (now - op.createdAt > op.ttlMs) {
      staged.delete(key);
    }
  }
}

/** Generate a confirmation token: shm_<24-char-alphanumeric> */
function generateToken(): string {
  return `shm_${randomBytes(18).toString("base64url").slice(0, 24)}`;
}

/** Compute SHA-256 hash of canonical JSON for args binding. */
function hashArgs(args: Record<string, unknown>): string {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// Confirmed Execution Flag
// ---------------------------------------------------------------------------

let _confirmedToken: string | null = null;

/**
 * Returns true if the current execution is a confirmed replay
 * (i.e., called from the confirmHandler after token validation).
 */
export function isConfirmedExecution(): boolean {
  return _confirmedToken !== null;
}

/**
 * Execute a function as a confirmed operation.
 * Sets the confirmed flag so handlers skip staging.
 */
export async function withConfirmation<T>(token: string, fn: () => Promise<T>): Promise<T> {
  _confirmedToken = token;
  try {
    return await fn();
  } finally {
    _confirmedToken = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Stage a mutating operation and return a confirmation token.
 */
export function stageOperation(
  tool: string,
  args: Record<string, unknown>,
  preview: string,
  account: string,
): string {
  prune();
  const token = generateToken();
  staged.set(token, {
    token,
    tool,
    args,
    argsHash: hashArgs(args),
    preview,
    createdAt: Date.now(),
    ttlMs: TOKEN_TTL_MS,
    account,
  });
  return token;
}

/**
 * Confirm (consume) a staged operation. Returns the operation if valid.
 * Throws if token is invalid, expired, or account mismatches.
 */
export function confirmOperation(
  token: string,
  currentAccount: string,
  force?: boolean,
): StagedOperation {
  prune();

  const op = staged.get(token);
  if (!op) {
    throw new Error(
      `Invalid or expired confirmation token: ${token}. ` +
      `Tokens expire after 120 seconds. Stage the operation again.`
    );
  }

  // Check expiry explicitly (prune might not have caught it)
  if (Date.now() - op.createdAt > op.ttlMs) {
    staged.delete(token);
    throw new Error(
      `Confirmation token expired: ${token}. ` +
      `Tokens expire after 120 seconds. Stage the operation again.`
    );
  }

  // Account binding check
  if (op.account !== "unknown" && currentAccount !== "unknown" && op.account !== currentAccount) {
    staged.delete(token);
    throw new Error(
      `Account mismatch: operation was staged for ${op.account} but ` +
      `current account is ${currentAccount}. Stage the operation again.`
    );
  }

  // Batch size guard — arrays of threadIds > 50 need force
  const threadIds = op.args.threadIds;
  if (Array.isArray(threadIds) && threadIds.length > 50 && !force) {
    // Don't consume the token — let them retry with force
    throw new Error(
      `Batch exceeds 50 items (${threadIds.length}). ` +
      `Re-confirm with force: true to proceed.`
    );
  }

  // Consume the token (single-use)
  staged.delete(token);
  return op;
}

/**
 * Build a staged response message including the confirmation token.
 */
export function buildStagedResponse(preview: string, token: string): string {
  return `STAGED — ${preview}\nConfirm: ${token}\nExpires in 120s.`;
}

/**
 * Build a preview string for a batch operation on thread IDs.
 * Uses tiered density based on batch size.
 */
export function buildBatchPreview(
  action: string,
  threadIds: string[],
): string {
  const count = threadIds.length;

  if (count <= 5) {
    // Full detail per thread (just IDs — we don't have metadata without provider)
    const list = threadIds.map((id, i) => `  ${i + 1}. ${id}`).join("\n");
    return `Would ${action} ${count} thread(s):\n${list}`;
  }

  if (count <= 20) {
    // Digest + thread list
    const list = threadIds.map((id, i) => `  ${i + 1}. ${id}`).join("\n");
    return `Would ${action} ${count} threads:\n${list}`;
  }

  if (count <= 50) {
    // Digest + 5-thread sample
    const sample = threadIds.slice(0, 5).map((id, i) => `  ${i + 1}. ${id}`).join("\n");
    return `Would ${action} ${count} threads (showing first 5):\n${sample}\n  ... and ${count - 5} more`;
  }

  // 51+: digest only, force required
  return `Would ${action} ${count} threads. WARNING: Large batch — force: true required on confirm.`;
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** Clear all staged operations (for testing). */
export function _clearStaged(): void {
  staged.clear();
  _confirmedToken = null;
}

/** Get count of staged operations (for testing). */
export function _stagedCount(): number {
  prune();
  return staged.size;
}
