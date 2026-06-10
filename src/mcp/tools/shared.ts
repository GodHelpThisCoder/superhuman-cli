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
import { CachedTokenProvider, CDPConnectionProvider, resolveProvider, type ConnectionProvider } from "../../connection-provider";
import {
  loadTokensFromDisk,
  getCachedToken,
  getCachedAccounts,
  hasCachedSuperhumanCredentials,
  getToken,
  type TokenInfo,
} from "../../token-api";
import { isKilled } from "../../kill-switch";
import { logAudit } from "../../audit";
import { createLogger } from "../../logger";
import { getLifecycleManager } from "../../lifecycle/manager";

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

    // Token expired and HTTP refresh failed — re-extract from CDP.
    // Superhuman's renderer always has a valid Google session, so we can
    // pull a fresh access token via Runtime.evaluate (same as `account auth`).
    log.info(`Token for ${activeEmail} expired, re-extracting from CDP...`);
    try {
      const conn = await getCdpConnection();
      const freshToken = await Promise.race([
        getToken(conn, activeEmail),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("CDP token extraction timed out")), 15_000)
        ),
      ]);
      if (freshToken) {
        log.info(`Token for ${activeEmail} refreshed successfully via CDP`);
        return new CachedTokenProvider(activeEmail);
      }
    } catch (err) {
      log.warn(`CDP token re-extraction failed for ${activeEmail}:`, err);
      throw new Error(
        `Token for ${activeEmail} expired and could not be refreshed (HTTP refresh failed, ` +
        `CDP extraction failed). Restart Superhuman to re-authenticate, then retry.`
      );
    }
  }

  // Step 3: Fall back to any cached tokens (single-account or CDP unavailable)
  if (!activeEmail) {
    const tokenProvider = await resolveProvider({ port: CDP_PORT });
    if (tokenProvider) return tokenProvider;
  }

  // Step 4: No cached tokens at all — use CDP connection provider directly.
  // This path is for initial setup only (no tokens on disk yet).
  // The provider is a stateless wrapper around the single cached CDP
  // connection (getCdpConnection), so constructing one per call is cheap.
  // Wrapped in a 15-second timeout to prevent indefinite hangs.
  const CDP_FALLBACK_TIMEOUT_MS = 15_000;

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(
      `CDP fallback timed out after ${CDP_FALLBACK_TIMEOUT_MS / 1000}s. ` +
      `Restart Superhuman to refresh tokens, then retry.`
    )), CDP_FALLBACK_TIMEOUT_MS)
  );

  return Promise.race([
    getCdpConnection().then((conn) => new CDPConnectionProvider(conn)),
    timeout,
  ]);
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

/** Invalidate the cached CDP connection (called on connection errors). */
export function invalidateCdpProvider(): void {
  if (_cachedCdpConn) {
    disconnect(_cachedCdpConn).catch(() => {});
    _cachedCdpConn = null;
  }
  _resolvedEmail = null;
  _resolvedEmailTs = 0;
}

// Cached raw CDP connection — the SINGLE shared connection for all tool calls.
let _cachedCdpConn: SuperhumanConnection | null = null;

// Mutex for getCdpConnection — prevents concurrent connection creation
let _cdpConnPromise: Promise<SuperhumanConnection> | null = null;

/**
 * Connect to Superhuman, consulting the LifecycleManager when one is
 * registered (MCP mode): the leader triggers/coalesces a launch and waits a
 * bounded time; followers and blocked states (updating, no-debug-port,
 * gave-up) fail fast with a status-rich, retryable error. In CLI mode
 * (no manager) it falls back to a direct launch — an explicit user action.
 */
async function connectWithPolicy(): Promise<SuperhumanConnection> {
  // Fast path — Superhuman may already be up
  let conn = await connectToSuperhuman(CDP_PORT, false).catch(() => null);
  if (conn) return conn;

  const manager = getLifecycleManager();
  if (manager) {
    const ready = await manager.ensureReady();
    if (ready.ok) {
      conn = await connectToSuperhuman(CDP_PORT, false).catch(() => null);
      if (conn) return conn;
      throw new Error(
        `Superhuman reports ready but the CDP connection on port ${CDP_PORT} failed. Retry shortly.`
      );
    }
    throw new Error(ready.reason);
  }

  // No manager (CLI context) — legacy direct-launch behavior
  log.warn("Superhuman not available, attempting launch...");
  await ensureSuperhuman(CDP_PORT);
  await new Promise(r => setTimeout(r, 3000));
  conn = await connectToSuperhuman(CDP_PORT, false).catch(() => null);
  if (!conn) {
    throw new Error(
      `Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=${CDP_PORT}`
    );
  }
  return conn;
}

/**
 * Get a cached raw CDP connection for handlers that need Runtime.evaluate
 * (e.g., agent sessions). Launch policy is delegated to the LifecycleManager.
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
    const conn = await connectWithPolicy();
    _cachedCdpConn = conn;
    return conn;
  })().finally(() => {
    _cdpConnPromise = null;
  });
  return _cdpConnPromise;
}

/**
 * Get UserInfo (Superhuman backend credentials) from a ConnectionProvider —
 * prefers cached tokens, falls back to live CDP extraction. Used by tools
 * that talk to Superhuman's own backend (drafts, snippets). The returned
 * idToken must never reach logs or tool results.
 */
export async function getUserInfoFromProvider(provider: ConnectionProvider): Promise<import("../../draft-api").UserInfo> {
  const { getUserInfo, getUserInfoFromCache } = await import("../../draft-api");
  const token = await provider.getToken();
  // Treat an expired (or expiring) idToken as missing: the HTTP refresh path
  // renews only the Google accessToken, so in a long-running server a "fresh"
  // token can carry an hours-old idToken — the Superhuman backend would 401.
  // The CDP fallback re-extracts a current idToken from the live renderer.
  const idTokenFresh =
    token.idToken &&
    (token.idTokenExpires == null || token.idTokenExpires > Date.now() + 60_000);
  if (token.userId && idTokenFresh) {
    return getUserInfoFromCache(token.userId, token.email, token.idToken!);
  }
  // Fallback: token lacks userId/idToken (or it's stale) — extract via the
  // shared CDP connection
  const conn = await getCdpConnection();
  return getUserInfo(conn);
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
  // Auth classification runs FIRST — our own auth-failure messages end in
  // "...then retry.", so a retry-substring pass-through ahead of this branch
  // would swallow the re-auth guidance.
  if (msg.includes("401") || msg.includes("auth") || msg.includes("Authentication")) {
    return errorResult(
      `Authentication failed: ${context}. Token may be expired. ` +
      `Use superhuman_accounts to verify account status, or restart Superhuman ` +
      `with --remote-debugging-port=${CDP_PORT} to re-authenticate.`
    );
  }
  // Lifecycle-manager errors are already actionable and state-specific
  // (updating / no-debug-port / backoff / follower) — pass them through
  // instead of burying them under generic connection advice.
  if (msg.includes("Retry") || msg.includes("retry") || msg.includes("superhuman doctor")) {
    return errorResult(`${context}: ${msg}`);
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
 * Check if an error is an authentication/401 error.
 * Used by paginateSearchAll for mid-pagination retry on token expiry.
 */
export function isAuthError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    return msg.includes("401") || msg.includes("Unauthorized") || msg.includes("Authentication");
  }
  return false;
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
