/**
 * Shared types and helpers for MCP tool handlers.
 */

import {
  connectToSuperhuman,
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

export const CDP_PORT = 9333;

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
 * Prefers cached tokens; falls back to CDP.
 */
export async function getMcpProvider(): Promise<ConnectionProvider> {
  const provider = await resolveProvider({ port: CDP_PORT });
  if (provider) return provider;

  const conn = await connectToSuperhuman(CDP_PORT);
  if (!conn) {
    throw new Error("Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
  }
  return new CDPConnectionProvider(conn);
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
      `with --remote-debugging-port=9333 to re-authenticate.`
    );
  }
  if (msg.includes("Could not connect") || msg.includes("ECONNREFUSED")) {
    return errorResult(
      `Connection failed: ${context}. Ensure Superhuman is running ` +
      `with --remote-debugging-port=9333. If it just started, wait a few seconds and retry.`
    );
  }
  return errorResult(`${context}: ${msg}. Verify Superhuman is running and the account is authenticated.`);
}

// Re-export types used by handlers
export type { SuperhumanConnection, ConnectionProvider, TokenInfo };
