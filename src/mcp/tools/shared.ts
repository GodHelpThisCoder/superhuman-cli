/**
 * Shared types and helpers for MCP tool handlers.
 */

import {
  connectToSuperhuman,
  disconnect,
  ensureSuperhuman,
  type SuperhumanConnection,
} from "../../superhuman-api";
import { listAccounts } from "../../accounts";
import { CDPConnectionProvider, resolveProvider, type ConnectionProvider } from "../../connection-provider";
import {
  loadTokensFromDisk,
  getCachedToken,
  getCachedAccounts,
  hasCachedSuperhumanCredentials,
  type TokenInfo,
} from "../../token-api";
import { isKilled } from "../../kill-switch";
import { logAudit } from "../../audit";
import { createLogger } from "../../logger";

const log = createLogger("mcp");

// Cache for resolved active email (avoids opening a new CDP connection per tool call)
let _resolvedEmail: string | null = null;
let _resolvedEmailTs = 0;
const RESOLVED_EMAIL_TTL_MS = 30_000; // 30 seconds

// Mutex for CDP email resolution — coalesces concurrent calls onto one CDP connection
// (same pattern as refreshWithLock in token-refresh.ts)
let _resolveEmailPromise: Promise<string> | null = null;

/**
 * Resolve the active account email with mutex protection.
 * If a resolution is already in flight (e.g. from parallel MCP tool calls),
 * subsequent callers await the same promise instead of opening redundant
 * CDP connections that can cause WebSocket instability.
 */
async function resolveEmailWithLock(): Promise<string> {
  if (_resolveEmailPromise) return _resolveEmailPromise;
  _resolveEmailPromise = resolveCurrentAccountViaCDP().finally(() => {
    _resolveEmailPromise = null;
  });
  return _resolveEmailPromise;
}

/**
 * Warm the resolved-email cache so subsequent parallel tool calls skip CDP.
 * Called by accountsHandler after listing accounts from CDP.
 */
export function warmResolvedEmailCache(email: string): void {
  _resolvedEmail = email;
  _resolvedEmailTs = Date.now();
}

export const CDP_PORT = parseInt(process.env.CDP_PORT || "9333", 10);

export type TextContent = { type: "text"; text: string };
export type ToolResult = { content: TextContent[]; isError?: boolean };

export function successResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Cached CDP provider — reused across tool calls, invalidated on error.
let _cachedCdpProvider: CDPConnectionProvider | null = null;

/**
 * Get a ConnectionProvider for MCP tools.
 * Resolves the active account from CDP, then returns a CachedTokenProvider
 * bound to that account. Falls back to CDP-only provider if no cached tokens.
 *
 * IMPORTANT: In multi-account setups, the active account in the Superhuman UI
 * may differ from the first cached account on disk. We always query CDP to
 * determine which account is active, then use cached tokens for that account.
 */
export async function getMcpProvider(): Promise<ConnectionProvider> {
  // Step 1: Determine active account from CDP (authoritative source)
  // Use cached email resolution if fresh enough (avoids opening a new CDP connection per tool call)
  let activeEmail: string | undefined;
  if (_resolvedEmail && Date.now() - _resolvedEmailTs < RESOLVED_EMAIL_TTL_MS) {
    activeEmail = _resolvedEmail;
  } else {
    try {
      activeEmail = await resolveEmailWithLock();
      _resolvedEmail = activeEmail;
      _resolvedEmailTs = Date.now();
    } catch {
      // Retry once after brief delay (transient CDP WebSocket drop)
      try {
        await new Promise(r => setTimeout(r, 500));
        activeEmail = await resolveEmailWithLock();
        _resolvedEmail = activeEmail;
        _resolvedEmailTs = Date.now();
      } catch {
        // CDP truly unavailable — will fall through to best-effort below
      }
    }
  }

  // Step 2: If we know the active account and have cached tokens, use them
  if (activeEmail) {
    const tokenProvider = await resolveProvider({ account: activeEmail, port: CDP_PORT });
    if (tokenProvider) return tokenProvider;
    // Token was found but expired and couldn't be refreshed — fail fast
    // instead of falling through to slow CDP extraction that can hang
    throw new Error(
      `Token for ${activeEmail} expired and could not be refreshed. ` +
      `Restart Superhuman to re-authenticate, then retry.`
    );
  }

  // Step 3: Fall back to any cached tokens (single-account or CDP unavailable)
  if (!activeEmail) {
    const tokenProvider = await resolveProvider({ port: CDP_PORT });
    if (tokenProvider) return tokenProvider;
  }

  // Step 4: No cached tokens at all — use CDP connection provider directly.
  // This path is for initial setup only (no tokens on disk yet).
  // Wrapped in a 15-second timeout to prevent indefinite hangs.
  const CDP_FALLBACK_TIMEOUT_MS = 15_000;

  const cdpFallback = async (): Promise<ConnectionProvider> => {
    if (_cachedCdpProvider) {
      try {
        await _cachedCdpProvider.getCurrentEmail();
        return _cachedCdpProvider;
      } catch {
        try { await _cachedCdpProvider.disconnect(); } catch { /* ignore */ }
        _cachedCdpProvider = null;
      }
    }

    let conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      log.warn("Superhuman not available, attempting launch...");
      await ensureSuperhuman(CDP_PORT);
      await new Promise(r => setTimeout(r, 3000));
      conn = await connectToSuperhuman(CDP_PORT, false);
    }
    if (!conn) {
      throw new Error(
        `Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=${CDP_PORT}`
      );
    }
    _cachedCdpProvider = new CDPConnectionProvider(conn);
    return _cachedCdpProvider;
  };

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(
      `CDP fallback timed out after ${CDP_FALLBACK_TIMEOUT_MS / 1000}s. ` +
      `Restart Superhuman to refresh tokens, then retry.`
    )), CDP_FALLBACK_TIMEOUT_MS)
  );

  return Promise.race([cdpFallback(), timeout]);
}

/**
 * Resolve the current account email directly from CDP (bypasses cached tokens).
 * This is the only reliable way to determine which account is active in the
 * Superhuman UI, since CachedTokenProvider.getCurrentEmail() returns the first
 * cached account from disk which may not match the active UI account.
 */
export async function resolveCurrentAccountViaCDP(): Promise<string> {
  const conn = await getCdpConnection();
  const accounts = await listAccounts(conn);
  const current = accounts.find((a) => a.isCurrent);
  if (!current) throw new Error("No current account found via CDP");
  return current.email;
  // Don't disconnect — connection is cached for reuse by getCdpConnection()
}

/** Invalidate the cached CDP provider (called on connection errors). */
export function invalidateCdpProvider(): void {
  if (_cachedCdpProvider) {
    _cachedCdpProvider.disconnect().catch(() => {});
    _cachedCdpProvider = null;
  }
  if (_cachedCdpConn) {
    disconnect(_cachedCdpConn).catch(() => {});
    _cachedCdpConn = null;
  }
  _resolvedEmail = null;
  _resolvedEmailTs = 0;
}

// Cached raw CDP connection — reused by handlers that need Runtime.evaluate.
let _cachedCdpConn: SuperhumanConnection | null = null;

// Mutex for getCdpConnection — prevents concurrent connection creation
let _cdpConnPromise: Promise<SuperhumanConnection> | null = null;

/**
 * Get a cached raw CDP connection for handlers that need Runtime.evaluate
 * (e.g., agent sessions). Includes auto-launch and connection validation.
 * Do NOT disconnect the returned connection — it is cached for reuse.
 * Uses mutex to prevent concurrent connection creation under parallel load.
 */
export async function getCdpConnection(): Promise<SuperhumanConnection> {
  // Fast path: reuse cached connection if healthy
  if (_cachedCdpConn) {
    try {
      await _cachedCdpConn.Runtime.evaluate({ expression: "1", returnByValue: true });
      return _cachedCdpConn;
    } catch {
      _cachedCdpConn = null;
    }
  }
  // Coalesce concurrent connection attempts onto one promise
  if (_cdpConnPromise) return _cdpConnPromise;
  _cdpConnPromise = (async () => {
    let conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      log.warn("Superhuman not available, attempting launch...");
      await ensureSuperhuman(CDP_PORT);
      await new Promise(r => setTimeout(r, 3000));
      conn = await connectToSuperhuman(CDP_PORT, false);
    }
    if (!conn) {
      throw new Error(
        `Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=${CDP_PORT}`
      );
    }
    _cachedCdpConn = conn;
    return conn;
  })().finally(() => {
    _cdpConnPromise = null;
  });
  return _cdpConnPromise;
}

/**
 * Resolve a cached Superhuman token with idToken + userId.
 * Tries any cached account with Superhuman credentials.
 */
export async function resolveSuperhumanToken(): Promise<TokenInfo | null> {
  await loadTokensFromDisk();
  const accounts = getCachedAccounts();
  for (const email of accounts) {
    if (await hasCachedSuperhumanCredentials(email)) {
      const token = await getCachedToken(email);
      if (token?.idToken && token?.userId) return token;
    }
  }
  return null;
}

/**
 * Build an actionable error message with recovery guidance.
 */
export function actionableError(context: string, error: unknown): ToolResult {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("401") || msg.includes("auth") || msg.includes("Authentication")) {
    return errorResult(
      `Authentication failed: ${context}. Token may be expired. ` +
      `Use superhuman_accounts to verify account status, or restart Superhuman ` +
      `with --remote-debugging-port=${CDP_PORT} to re-authenticate.`
    );
  }
  if (msg.includes("Could not connect") || msg.includes("ECONNREFUSED")) {
    return errorResult(
      `Connection failed: ${context}. Ensure Superhuman is running ` +
      `with --remote-debugging-port=${CDP_PORT}. If it just started, wait a few seconds and retry.`
    );
  }
  return errorResult(`${context}: ${msg}. Verify Superhuman is running and the account is authenticated.`);
}

/**
 * Guard for mutating handlers — returns an error if the kill switch is active.
 * Must be called synchronously at the top of every mutating handler.
 */
export function guardMutation(tool?: string, args?: Record<string, unknown>): ToolResult | null {
  const { killed, reason } = isKilled();
  if (killed) {
    if (tool) {
      logAudit({ tool, account: "unknown", action: "killed", args: args || {}, result: "error", dryRun: false })
        .catch(() => {});
    }
    return errorResult(
      `KILLED — ${reason || "All mutations suspended."}\nRemove kill-switch file to resume.`
    );
  }
  return null;
}

/**
 * Log an audit entry for a completed mutation. Fire-and-forget.
 */
export function auditMutation(
  tool: string,
  args: Record<string, unknown>,
  account: string,
  result: ToolResult,
  options?: { batchSize?: number; durationMs?: number; action?: "executed" | "staged" | "confirmed" },
): void {
  logAudit({
    tool,
    account,
    action: options?.action || "executed",
    args,
    result: result.isError ? "error" : "success",
    error: result.isError ? result.content[0]?.text : undefined,
    batchSize: options?.batchSize,
    durationMs: options?.durationMs,
    dryRun: false,
  }).catch(() => {});
}

/**
 * Log an audit entry for a dry-run operation. Fire-and-forget.
 */
export function auditDryRun(
  tool: string,
  args: Record<string, unknown>,
  durationMs?: number,
): void {
  logAudit({
    tool,
    account: "dry-run",
    action: "executed",
    args: { ...args, dryRun: true },
    result: "dry_run",
    dryRun: true,
    durationMs,
  }).catch(() => {});
}

// Re-export types used by handlers
export type { SuperhumanConnection, ConnectionProvider, TokenInfo };
