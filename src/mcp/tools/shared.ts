/**
 * Shared types and helpers for MCP tool handlers.
 */

import {
  connectToSuperhuman,
  ensureSuperhuman,
  type SuperhumanConnection,
} from "../../superhuman-api";
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
 * Prefers cached tokens; falls back to CDP with auto-reconnect.
 *
 * If the CDP connection is stale (Superhuman restarted), the cached provider
 * is invalidated and a fresh connection is established. If Superhuman is not
 * running, `ensureSuperhuman()` will attempt to launch it.
 */
export async function getMcpProvider(): Promise<ConnectionProvider> {
  // Cached tokens don't need CDP — always prefer them
  const tokenProvider = await resolveProvider({ port: CDP_PORT });
  if (tokenProvider) return tokenProvider;

  // Return cached CDP provider if still valid
  if (_cachedCdpProvider) {
    try {
      // Quick liveness check — will throw if connection is dead
      await _cachedCdpProvider.getCurrentEmail();
      return _cachedCdpProvider;
    } catch {
      // Connection stale — invalidate and reconnect below
      try { await _cachedCdpProvider.disconnect(); } catch { /* ignore */ }
      _cachedCdpProvider = null;
    }
  }

  // Attempt connection (with auto-launch)
  let conn = await connectToSuperhuman(CDP_PORT);
  if (!conn) {
    // Superhuman may be starting — wait and retry once
    console.error("[mcp] Superhuman not available, attempting launch...");
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
}

/** Invalidate the cached CDP provider (called on connection errors). */
export function invalidateCdpProvider(): void {
  if (_cachedCdpProvider) {
    _cachedCdpProvider.disconnect().catch(() => {});
    _cachedCdpProvider = null;
  }
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
  options?: { batchSize?: number; action?: "executed" | "staged" | "confirmed" },
): void {
  logAudit({
    tool,
    account,
    action: options?.action || "executed",
    args,
    result: result.isError ? "error" : "success",
    error: result.isError ? result.content[0]?.text : undefined,
    batchSize: options?.batchSize,
    dryRun: false,
  }).catch(() => {});
}

// Re-export types used by handlers
export type { SuperhumanConnection, ConnectionProvider, TokenInfo };
