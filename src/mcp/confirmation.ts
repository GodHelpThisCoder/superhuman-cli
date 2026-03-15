/**
 * Two-Phase Commit — server-enforced staging with confirmation tokens.
 *
 * Mutating operations are staged and return a single-use token that must be
 * confirmed via `superhuman_confirm` before execution.
 */

import { createHash, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ConnectionProvider } from "../connection-provider";
import { readThread } from "../read";
import { logAudit } from "../audit";

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

export interface ManifestThreadInfo {
  threadId: string;
  subject: string;
  from: string;
  date: string;
}

export interface BatchManifest {
  threads: ManifestThreadInfo[];
  digest: string;
  anomalies: string[];
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
      logAudit({
        tool: op.tool,
        account: op.account,
        action: "expired",
        args: op.args,
        token: op.token,
        result: "error",
        error: "Confirmation token expired before execution",
        dryRun: false,
      }).catch(() => {});
      staged.delete(key);
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await fn(items[current]!);
    }
  });

  await Promise.all(workers);
  return results;
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

const confirmedContext = new AsyncLocalStorage<{ token: string }>();

/**
 * Returns true if the current execution is a confirmed replay
 * (i.e., called from the confirmHandler after token validation).
 */
export function isConfirmedExecution(): boolean {
  return !!confirmedContext.getStore();
}

/**
 * Execute a function as a confirmed operation.
 * Sets the confirmed flag so handlers skip staging.
 */
export async function withConfirmation<T>(token: string, fn: () => Promise<T>): Promise<T> {
  return confirmedContext.run({ token }, fn);
}

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function formatShortDate(rawDate: string): string {
  if (!rawDate) return "unknown";
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return "unknown";
  return SHORT_DATE_FORMAT.format(parsed);
}

/**
 * Extract root domain (eTLD+1 heuristic) from an email address or domain string.
 * Uses a simple heuristic: last 2 segments, or 3 if penultimate is co/com/org/net/edu/gov.
 */
export function extractRootDomain(sender: string): string {
  const domain = sender.includes("@") ? sender.split("@")[1] : sender;
  if (!domain) return sender;
  const parts = domain.toLowerCase().split(".");
  if (parts.length <= 2) return domain.toLowerCase();
  const secondToLast = parts[parts.length - 2];
  const ccSLDs = ["co", "com", "org", "net", "edu", "gov", "ac"];
  if (secondToLast && ccSLDs.includes(secondToLast) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/**
 * Group anomalous sender emails by root domain.
 * Returns domain-grouped strings like "*.creditkarma.com (3 threads across 3 senders)"
 */
function groupAnomaliesByDomain(senders: string[]): string[] {
  if (senders.length === 0) return [];
  const domainGroups = new Map<string, string[]>();
  for (const sender of senders) {
    const domain = extractRootDomain(sender);
    const existing = domainGroups.get(domain);
    if (existing) {
      existing.push(sender);
    } else {
      domainGroups.set(domain, [sender]);
    }
  }
  return Array.from(domainGroups.entries())
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([domain, grouped]) => {
      if (grouped.length === 1) return grouped[0]!;
      return `*.${domain} (${grouped.length} senders)`;
    });
}

function fallbackManifest(threadIds: string[]): BatchManifest {
  const count = threadIds.length;
  return {
    threads: threadIds.map((threadId) => ({
      threadId,
      subject: "(metadata unavailable)",
      from: "unknown",
      date: "unknown",
    })),
    digest: `Digest: ${count} thread${count === 1 ? "" : "s"} | oldest: unknown | newest: unknown`,
    anomalies: [],
  };
}

/**
 * Build sender/date manifest for batch previews.
 * Best-effort only: metadata lookup failures are included as unknown rows.
 */
export async function buildManifest(
  provider: ConnectionProvider,
  threadIds: string[],
): Promise<BatchManifest> {
  const threads = await mapWithConcurrency(threadIds, 10, async (threadId) => {
    try {
      const messages = await readThread(provider, threadId);
      const latest = messages[messages.length - 1] ?? messages[0];
      return {
        threadId,
        subject: latest?.subject || "(unknown subject)",
        from: latest?.from?.email || latest?.from?.name || "unknown",
        date: latest?.date || "unknown",
      };
    } catch {
      return {
        threadId,
        subject: "(metadata unavailable)",
        from: "unknown",
        date: "unknown",
      };
    }
  });

  const senderCounts = new Map<string, number>();
  const validDates: number[] = [];
  for (const thread of threads) {
    senderCounts.set(thread.from, (senderCounts.get(thread.from) || 0) + 1);

    const ts = Date.parse(thread.date);
    if (!Number.isNaN(ts)) {
      validDates.push(ts);
    }
  }

  const oldest = validDates.length > 0 ? formatShortDate(new Date(Math.min(...validDates)).toISOString()) : "unknown";
  const newest = validDates.length > 0 ? formatShortDate(new Date(Math.max(...validDates)).toISOString()) : "unknown";
  const total = threads.length;

  // Identify anomalous senders (<5% of batch) and group by domain
  const anomalousSenders: string[] = [];
  const senderLines = Array.from(senderCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([sender, count]) => {
      const anomalous = total > 0 && count / total < 0.05;
      if (anomalous) {
        anomalousSenders.push(sender);
      }
      return `  ${count} from ${sender}${anomalous ? " <-- ANOMALY (<5%)" : ""}`;
    });

  // Group anomalies by root domain (eTLD+1 heuristic)
  const anomalies = groupAnomaliesByDomain(anomalousSenders);

  const digestHeader = `Digest: ${total} thread${total === 1 ? "" : "s"} | oldest: ${oldest} | newest: ${newest}`;

  return {
    threads,
    digest: senderLines.length > 0 ? `${digestHeader}\n${senderLines.join("\n")}` : digestHeader,
    anomalies,
  };
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
    logAudit({
      tool: op.tool,
      account: op.account,
      action: "expired",
      args: op.args,
      token: op.token,
      result: "error",
      error: "Confirmation token expired",
      dryRun: false,
    }).catch(() => {});
    staged.delete(token);
    throw new Error(
      `Confirmation token expired: ${token}. ` +
      `Tokens expire after 120 seconds. Stage the operation again.`
    );
  }

  // Account binding check — never consume token when account can't be verified
  if (op.account === "unknown" || currentAccount === "unknown") {
    throw new Error(
      `Account binding unavailable for token ${token}. ` +
      `Retry when CDP is available, or re-stage the operation.`
    );
  }

  if (op.account !== currentAccount) {
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
  manifest?: BatchManifest,
): string {
  const resolvedManifest = manifest ?? fallbackManifest(threadIds);
  const count = threadIds.length;
  const detail = (thread: ManifestThreadInfo, i: number) =>
    `  ${i + 1}. ${thread.threadId} — "${thread.subject}" (from ${thread.from}, ${formatShortDate(thread.date)})`;

  if (count <= 5) {
    const list = resolvedManifest.threads.map((thread, i) => detail(thread, i)).join("\n");
    return `Would ${action} ${count} thread(s):\n${resolvedManifest.digest}\n${list}`;
  }

  if (count <= 20) {
    const list = resolvedManifest.threads.map((thread, i) => detail(thread, i)).join("\n");
    return `Would ${action} ${count} threads:\n${resolvedManifest.digest}\nSubjects:\n${list}`;
  }

  if (count <= 50) {
    const sample = resolvedManifest.threads.slice(0, 5).map((thread, i) => detail(thread, i)).join("\n");
    return `Would ${action} ${count} threads (showing first 5):\n${resolvedManifest.digest}\nSample:\n${sample}\n  ... and ${count - 5} more`;
  }

  return `Would ${action} ${count} threads.\n${resolvedManifest.digest}\nWARNING: Large batch — force: true required on confirm.`;
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** Clear all staged operations (for testing). */
export function _clearStaged(): void {
  staged.clear();
}

/** Get count of staged operations (for testing). */
export function _stagedCount(): number {
  prune();
  return staged.size;
}
