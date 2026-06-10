/**
 * Token Store Module
 *
 * In-memory token cache and encrypted disk persistence.
 * Tokens are encrypted at rest using AES-256-GCM with a machine-bound key.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { chmodSync } from "node:fs";
import type { TokenInfo, PersistedTokens } from "./types";
import type { SuperhumanConnection } from "../cdp/connection";
import { getConfigDir } from "../config";
import { createLogger } from "../logger";

const log = createLogger("token-store");

// ---------------------------------------------------------------------------
// AES-256-GCM encryption — key is derived from machine identity
//
// Design note: The key is derived from hostname + username, both guessable.
// This is defense-in-depth against accidental file exposure (backups, sharing,
// dotfile repos) — not protection against same-user processes. File permissions
// (0o600) are the primary access control. The deterministic derivation ensures
// the same user on the same machine can always decrypt without storing a
// separate key.
// ---------------------------------------------------------------------------

const SALT = "superhuman-cli-v1";
const KEY_MATERIAL = `${hostname()}:${userInfo().username}:${SALT}`;
const KEY = scryptSync(KEY_MATERIAL, SALT, 32);
const ALGORITHM = "aes-256-gcm" as const;

function encrypt(data: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY as Buffer, iv);
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

function decrypt(data: string): string {
  const parts = data.split(":");
  if (parts.length < 3) {
    throw new Error("Malformed encrypted token data — expected iv:tag:ciphertext format");
  }
  const ivHex = parts[0]!;
  const tagHex = parts[1]!;
  const encrypted = parts.slice(2).join(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, KEY as Buffer, iv);
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ---------------------------------------------------------------------------
// In-memory token cache
// ---------------------------------------------------------------------------

/** In-memory token cache keyed by email address. */
const tokenCache = new Map<string, TokenInfo>();

/** Get a token from the in-memory cache (no refresh logic). */
export function getTokenFromCache(email: string): TokenInfo | undefined {
  return tokenCache.get(email);
}

/** Set a token in the in-memory cache. */
export function setTokenInCache(email: string, token: TokenInfo): void {
  tokenCache.set(email, token);
}

/** Delete a single token from the in-memory cache. */
export function deleteTokenFromCache(email: string): boolean {
  return tokenCache.delete(email);
}

// ---------------------------------------------------------------------------
// Config paths — evaluated at call time for testability
// ---------------------------------------------------------------------------

function getTokensFile(): string {
  return `${getConfigDir()}/tokens.json`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get OAuth token for an account, using cache if available.
 *
 * Proactively refreshes tokens that are expired or expiring soon
 * (within 5 minutes) to avoid API failures.
 *
 * When a CDP connection is not available, use {@link getCachedToken} instead.
 *
 * @param conn - Superhuman connection (used for fresh extraction)
 * @param email - Account email to get token for
 * @returns TokenInfo from cache or freshly extracted
 */
export async function getToken(
  conn: SuperhumanConnection,
  email: string,
): Promise<TokenInfo> {
  // Lazy-import to avoid circular dependency (token-extract imports setter helpers from this module)
  const { extractToken } = await import("./token-extract");

  // Check cache first
  const cached = tokenCache.get(email);

  if (cached) {
    // Check if token is expired or expiring soon (within 5 minutes)
    const bufferMs = 5 * 60 * 1000;
    const isExpiredOrExpiring = cached.expires < Date.now() + bufferMs;

    if (!isExpiredOrExpiring) {
      return cached;
    }
    // Token expired or expiring soon, fall through to extract fresh
  }

  // Extract fresh token
  const token = await extractToken(conn, email);

  // Cache it
  tokenCache.set(email, token);

  return token;
}

/**
 * Clear the token cache.
 * Useful for testing or forcing token refresh.
 */
export function clearTokenCache(): void {
  tokenCache.clear();
  // Keep the refresh-failure cooldown in lockstep with the token cache —
  // a stale negative-cache entry would suppress refresh attempts for a
  // freshly re-authenticated account (and leak state between tests).
  refreshFailureAt.clear();
}

/**
 * Test helper: Set token in cache directly.
 * Only use in tests to simulate expiry scenarios.
 */
export function setTokenCacheForTest(email: string, token: TokenInfo): void {
  tokenCache.set(email, token);
  refreshFailureAt.delete(email);
}

/**
 * Check if all cached tokens are still valid.
 *
 * Returns false if cache is empty or any token is expired
 * or expiring within 5 minutes.
 */
export function hasValidCachedTokens(): boolean {
  if (tokenCache.size === 0) {
    return false;
  }

  const bufferMs = 5 * 60 * 1000; // 5 minutes
  for (const token of tokenCache.values()) {
    if (token.expires < Date.now() + bufferMs) {
      return false; // At least one token expired or expiring soon
    }
  }

  return true;
}

/**
 * Get cached token for a specific account.
 *
 * If the token is expired or expiring within 5 minutes:
 * - Attempts to refresh using the refresh token
 * - Persists the refreshed token to disk
 * - Returns undefined if refresh fails
 *
 * @param email - Account email
 * @returns Token info if valid/refreshed, undefined otherwise
 */
// Negative-result cooldown: after a failed refresh, don't re-fire HTTP refresh
// attempts for the same account on every tool call (the expired entry stays in
// the cache, so without this each call retries the same doomed refresh).
const REFRESH_FAILURE_COOLDOWN_MS = 60_000;
const refreshFailureAt = new Map<string, number>();

export async function getCachedToken(
  email: string,
): Promise<TokenInfo | undefined> {
  const token = tokenCache.get(email);
  if (!token) return undefined;

  const bufferMs = 5 * 60 * 1000; // 5 minutes
  if (token.expires < Date.now() + bufferMs) {
    // Token expired or expiring soon — try to refresh
    const lastFailure = refreshFailureAt.get(email);
    if (lastFailure && Date.now() - lastFailure < REFRESH_FAILURE_COOLDOWN_MS) {
      // Recent refresh failure — don't hammer the token endpoint
      return undefined;
    }
    if (token.refreshToken) {
      const { refreshWithLock } = await import("./token-refresh");
      const refreshed = await refreshWithLock(email, token);
      if (refreshed) {
        refreshFailureAt.delete(email);
        tokenCache.set(email, refreshed);
        await saveTokensToDisk();
        return refreshed;
      }
    }
    // Refresh failed or no refresh token
    refreshFailureAt.set(email, Date.now());
    log.warn(`Token for ${email} expired. Run 'superhuman account auth' to re-authenticate.`);
    return undefined;
  }

  return token;
}

/**
 * Get list of cached account emails.
 */
export function getCachedAccounts(): string[] {
  return Array.from(tokenCache.keys());
}

/**
 * Check if we have valid cached credentials for Superhuman API.
 * Requires both idToken and userId.
 */
export async function hasCachedSuperhumanCredentials(
  email: string,
): Promise<boolean> {
  const token = await getCachedToken(email);
  return !!(token?.idToken && token?.userId);
}

/**
 * Get the path to the tokens file.
 * Useful for displaying to users where tokens are stored.
 */
export function getTokensFilePath(): string {
  return getTokensFile();
}

// ---------------------------------------------------------------------------
// Disk persistence (encrypted)
// ---------------------------------------------------------------------------

/**
 * Save all cached tokens to disk (AES-256-GCM encrypted).
 *
 * Creates config directory if needed and writes tokens.json.
 * The file is chmod 600 (owner read/write only).
 * Called by the `auth` command after extracting tokens via CDP.
 */
// Write serialization lock — prevents concurrent Bun.write calls from corrupting the token file
let _diskWriteLock: Promise<void> = Promise.resolve();

export async function saveTokensToDisk(): Promise<void> {
  const prev = _diskWriteLock;
  let resolve: () => void;
  _diskWriteLock = new Promise((r) => { resolve = r; });
  await prev;

  try {
    const { mkdir } = await import("node:fs/promises");
    const configDir = getConfigDir();
    const tokensFile = getTokensFile();

    await mkdir(configDir, { recursive: true });

    const data: PersistedTokens = {
      version: 1,
      accounts: {},
      lastUpdated: Date.now(),
    };

    // Convert in-memory cache to persisted format
    for (const [email, token] of Array.from(tokenCache.entries())) {
      data.accounts[email] = {
        type: token.isMicrosoft ? "microsoft" : "google",
        accessToken: token.accessToken,
        expires: token.expires,
        userId: token.userId,
        refreshToken: token.refreshToken,
        userPrefix: token.userPrefix,
        clientId: token.clientId,
        displayName: token.displayName,
        superhumanToken: token.idToken
          ? {
              token: token.idToken,
              expires: token.idTokenExpires,
            }
          : undefined,
      };
    }

    const plaintext = JSON.stringify(data, null, 2);
    const ciphertext = encrypt(plaintext);

    await Bun.write(tokensFile, ciphertext);

    // Restrict file permissions to owner only (no-op on Windows but good practice)
    try {
      chmodSync(tokensFile, 0o600);
    } catch (error) {
      log.warn(`chmod token file: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    resolve!();
  }
}

/**
 * Load tokens from disk into memory cache.
 *
 * Handles three on-disk formats:
 * 1. AES-256-GCM encrypted (current) — decrypt and parse
 * 2. Plaintext JSON (legacy, starts with `{`) — parse and re-encrypt in place
 * 3. Corrupt / unreadable — log warning and return false
 *
 * Called at CLI startup to check for cached tokens before
 * attempting CDP connection.
 *
 * @returns true if tokens were loaded successfully, false otherwise
 */
export async function loadTokensFromDisk(): Promise<boolean> {
  try {
    const tokensFile = getTokensFile();
    const file = Bun.file(tokensFile);
    if (!(await file.exists())) {
      return false;
    }

    const raw = await file.text();
    let data: PersistedTokens;

    if (raw.trimStart().startsWith("{")) {
      // Legacy plaintext JSON — parse then migrate to encrypted format
      try {
        data = JSON.parse(raw) as PersistedTokens;
      } catch (error) {
        log.error(`token file JSON parse: ${error instanceof Error ? error.message : String(error)}`);
        log.warn("Token file contains invalid JSON — ignoring.");
        return false;
      }

      // Populate cache first so saveTokensToDisk can serialize it
      populateCache(data);

      // Re-encrypt in place
      try {
        await saveTokensToDisk();
      } catch (e) {
        log.warn("Failed to migrate token file to encrypted format:", e);
      }

      return true;
    }

    // Encrypted format — decrypt
    let plaintext: string;
    try {
      plaintext = decrypt(raw);
    } catch (error) {
      log.error(`token file decrypt: ${error instanceof Error ? error.message : String(error)}`);
      log.warn("Failed to decrypt token file (machine identity may have changed). Run 'superhuman auth' to re-authenticate.");
      return false;
    }

    try {
      data = JSON.parse(plaintext) as PersistedTokens;
    } catch (error) {
      log.error(`decrypted token JSON parse: ${error instanceof Error ? error.message : String(error)}`);
      log.warn("Decrypted token data is not valid JSON — ignoring.");
      return false;
    }

    // Validate version
    if (data.version !== 1) {
      return false;
    }

    populateCache(data);
    return true;
  } catch (error) {
    log.error(`load tokens from disk: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Populate the in-memory cache from a PersistedTokens structure.
 */
function populateCache(data: PersistedTokens): void {
  for (const [email, account] of Object.entries(data.accounts)) {
    tokenCache.set(email, {
      accessToken: account.accessToken,
      email,
      expires: account.expires,
      isMicrosoft: account.type === "microsoft",
      userId: account.userId,
      refreshToken: account.refreshToken,
      idToken: account.superhumanToken?.token,
      idTokenExpires: account.superhumanToken?.expires,
      userPrefix: account.userPrefix,
      clientId: account.clientId,
      displayName: account.displayName,
      superhumanToken: account.superhumanToken
        ? { token: account.superhumanToken.token, expires: account.superhumanToken.expires ?? 0 }
        : undefined,
    });
  }
}
