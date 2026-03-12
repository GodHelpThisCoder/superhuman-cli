/**
 * OAuth token refresh with client_id extraction and concurrent-refresh protection.
 *
 * 1. Extracts `client_id` from the JWT access-token (`aud` or `azp` claim).
 * 2. Includes it in the token-refresh POST body (required for public-client OAuth).
 * 3. Provides a per-email mutex (`refreshWithLock`) so concurrent callers
 *    don't fire duplicate refresh requests.
 *
 * // Previously lived in token-api.ts
 */

import type { TokenInfo } from "./types";
import { createLogger } from "../logger";

const log = createLogger("token-refresh");

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/**
 * Decode a base64url-encoded string (no padding) to a UTF-8 string.
 */
function base64urlDecode(input: string): string {
  // base64url -> base64: replace URL-safe chars and re-pad
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad === 2) base64 += "==";
  else if (pad === 3) base64 += "=";

  // Works in both Node/Bun (Buffer) and edge runtimes (atob)
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64").toString("utf-8");
  }
  return decodeURIComponent(
    atob(base64)
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Extract the OAuth `client_id` from a JWT access token.
 *
 * Google access tokens are JWTs whose payload contains an `aud` (audience)
 * claim set to the OAuth client_id, and an `azp` (authorized party) claim
 * that also holds the client_id.  Microsoft v2 tokens similarly carry `aud`.
 *
 * Returns `null` if the token is opaque or cannot be decoded.
 */
export function extractClientId(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) {
      // Not a JWT (e.g. opaque token) — nothing to extract
      return null;
    }

    const payload = JSON.parse(base64urlDecode(parts[1]!));

    // Prefer `azp` (authorized party — always the client_id in Google tokens),
    // fall back to `aud` which may be a string or an array.
    if (typeof payload.azp === "string" && payload.azp.length > 0) {
      return payload.azp;
    }
    if (typeof payload.aud === "string" && payload.aud.length > 0) {
      return payload.aud;
    }
    if (Array.isArray(payload.aud) && payload.aud.length > 0) {
      return payload.aud[0];
    }

    return null;
  } catch (error) {
    log.error(`JWT client_id extraction: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Refresh an OAuth access token using the refresh token.
 *
 * Calls the appropriate OAuth endpoint (Google or Microsoft) to exchange
 * the refresh token for a new access token. Includes the `client_id`
 * parameter extracted from the JWT, which is required for public-client
 * OAuth flows.
 *
 * @param token - Current TokenInfo (must contain a refreshToken)
 * @returns Updated TokenInfo with a fresh access token, or null on failure
 */
export async function refreshAccessToken(
  token: TokenInfo
): Promise<TokenInfo | null> {
  if (!token.refreshToken) {
    log.error(`Cannot refresh token for ${token.email}: no refresh token available`);
    return null;
  }

  const endpoint = token.isMicrosoft
    ? "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    : "https://oauth2.googleapis.com/token";

  // Resolve client_id: prefer the cached value on the token, then try to
  // extract it from the JWT, and finally fall back to undefined (omitted).
  const clientId =
    token.clientId ?? extractClientId(token.accessToken) ?? undefined;

  if (!clientId) {
    log.warn(`Could not determine client_id for ${token.email}; the refresh request may fail`);
  }

  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
  };

  if (clientId) {
    body.client_id = clientId;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    });

    if (!response.ok) {
      let error: unknown, error_description: unknown;
      try {
        ({ error, error_description } = JSON.parse(await response.text()) as Record<string, unknown>);
      } catch {
        // Response body is not JSON (e.g., "Unauthorized")
      }
      log.error(
        `Refresh failed for ${token.email}: HTTP ${response.status} ${response.statusText}` +
          (error ? ` — ${error}: ${error_description || ""}` : "")
      );
      return null;
    }

    const data = JSON.parse(await response.text()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    return {
      ...token,
      accessToken: data.access_token,
      expires: Date.now() + data.expires_in * 1000,
      refreshToken: data.refresh_token || token.refreshToken,
      // Cache the client_id so future refreshes don't need to re-decode
      clientId: clientId ?? token.clientId,
    };
  } catch (error) {
    log.error(
      `Network/parse error refreshing token for ${token.email}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Concurrent-refresh mutex
// ---------------------------------------------------------------------------

/**
 * In-flight refresh promises keyed by email address.
 *
 * When multiple call-sites attempt to refresh the same account concurrently
 * (e.g. parallel MCP tool calls), the first caller wins and subsequent
 * callers await the same promise instead of firing redundant HTTP requests.
 */
const refreshLocks = new Map<string, Promise<TokenInfo | null>>();

/**
 * Refresh with per-email mutex protection.
 *
 * If a refresh is already in progress for the given email, returns the
 * existing promise.  Otherwise kicks off a new refresh and registers it
 * so that concurrent callers coalesce onto the same request.
 *
 * @param email  - Account email (used as the mutex key)
 * @param token  - Current TokenInfo to refresh
 * @returns Updated TokenInfo or null on failure
 */
export async function refreshWithLock(
  email: string,
  token: TokenInfo
): Promise<TokenInfo | null> {
  const existing = refreshLocks.get(email);
  if (existing) {
    return existing;
  }

  const promise = refreshAccessToken(token).finally(() =>
    refreshLocks.delete(email)
  );
  refreshLocks.set(email, promise);
  return promise;
}
