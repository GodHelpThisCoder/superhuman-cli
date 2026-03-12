/**
 * Token Extraction Module
 *
 * Extracts OAuth and Superhuman backend tokens via CDP evaluation
 * and Chrome extension network interception.
 */

import type { TokenInfo, CapturedToken, SuperhumanTokenInfo } from "./types";
import type { SuperhumanConnection, ChromeExtConnection } from "../superhuman-api";
import { setTokenInCache } from "./token-store";
import { listAccounts, switchAccount } from "../accounts";
import { createLogger } from "../logger";

const log = createLogger("token-extract");

// ============================================================================
// In-memory caches
// ============================================================================

// OAuth token cache is imported from ./token-store (shared across modules)
// Superhuman backend token cache is local to this module
const superhumanTokenCache = new Map<string, SuperhumanTokenInfo>();

// ============================================================================
// OAuth Token Extraction (Electron desktop app)
// ============================================================================

/**
 * Extract OAuth token for a specific account.
 *
 * Switches to the account and extracts credential._authData.
 * Returns token info with expiry timestamp.
 */
export async function extractToken(
  conn: SuperhumanConnection,
  email: string
): Promise<TokenInfo> {
  const { Runtime } = conn;

  // Verify account exists
  const accounts = await listAccounts(conn);
  const accountExists = accounts.some((a) => a.email === email);

  if (!accountExists) {
    const available = accounts.map((a) => a.email).join(", ");
    throw new Error(`Account not found: ${email}. Available: ${available}`);
  }

  // Switch to the target account
  const switchResult = await switchAccount(conn, email);
  if (!switchResult.success) {
    throw new Error(`Failed to switch to account: ${email}`);
  }

  // Wait for account to fully load
  await new Promise((r) => setTimeout(r, 1000));

  // Extract token from credential._authData
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const authData = ga?.credential?._authData;
          const user = ga?.credential?.user;
          const di = ga?.di;

          if (!authData?.accessToken) {
            return { error: "No access token found" };
          }

          // Extract user prefix for event ID generation
          let userPrefix = null;
          try {
            const shUserId = ga?.labels?._settings?._cache?.userId;
            if (shUserId) {
              const suffix = shUserId.replace('user_', '');
              if (suffix.length >= 11) {
                userPrefix = suffix.substring(7, 11);
              }
            }
          } catch (_) {}

          return {
            accessToken: authData.accessToken,
            email: ga?.emailAddress || '',
            expires: authData.expires || (Date.now() + 3600000),
            isMicrosoft: !!di?.get?.('isMicrosoft'),
            // OAuth refresh token for background refresh
            refreshToken: authData.refreshToken,
            // Superhuman backend API fields
            userId: user?._id,
            idToken: authData.idToken,
            idTokenExpires: authData.expires,
            userPrefix: userPrefix,
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  const value = result.result.value as TokenInfo | { error: string };

  if ("error" in value) {
    throw new Error(`Token extraction failed: ${value.error}`);
  }

  return {
    ...value,
    superhumanToken: value.idToken
      ? {
          token: value.idToken,
          expires: value.idTokenExpires ?? 0,
        }
      : undefined,
  };
}

// ============================================================================
// Chrome Extension Token Extraction
// ============================================================================

/**
 * Pick the Superhuman backend (Firebase) token from a list of captured JWTs.
 * Prefers tokens from /~backend/ endpoints, then Firebase issuer, then first available.
 */
export function selectBestToken(
  tokens: CapturedToken[],
  email: string
): string | null {
  // Filter to tokens for the target account
  const forAccount = tokens.filter((t) => t.email === email || !t.email);

  // Prefer token used on /~backend/ endpoints
  const backendToken = forAccount.find((t) => t.url.includes("/~backend/"));
  if (backendToken) return backendToken.token;

  // Fallback: find Firebase token by JWT issuer
  for (const t of forAccount) {
    try {
      const payload = JSON.parse(
        Buffer.from(t.token.split(".")[1] ?? "", "base64url").toString()
      );
      if (payload.iss?.includes("securetoken.googleapis.com")) {
        return t.token;
      }
    } catch {
      // Token is not a valid JWT — skip silently
    }
  }

  // Last resort: return first token with auth
  return forAccount[0]?.token ?? null;
}

/**
 * Extract tokens for an account via Chrome extension CDP interception.
 *
 * Intercepts network requests from the service worker to capture:
 * 1. Superhuman backend token (Firebase JWT used for /~backend/ calls)
 * 2. Provider access token (Google/Microsoft OAuth token)
 */
export async function extractTokenChrome(
  conn: ChromeExtConnection,
  email: string
): Promise<TokenInfo> {
  const { swClient, mainClient } = conn;

  // 1. Read account metadata from service worker
  const meta = await swClient.Runtime.evaluate({
    expression: `(() => {
      const bg = backgrounds[${JSON.stringify(email)}]?._accountBackground;
      if (!bg) return null;
      let userPrefix = null;
      try {
        const uid = bg.settings?._cache?.userId;
        if (uid) {
          const s = uid.replace("user_", "");
          if (s.length >= 11) userPrefix = s.substring(7, 11);
        }
      } catch (error) {
        console.error("Failed to extract userPrefix from service worker:", error);
      }
      return {
        userId: bg.labels?._user?._id || null,
        provider: bg.provider || "google",
        userPrefix,
      };
    })()`,
    returnByValue: true,
  });

  const metadata = meta.result.value as {
    userId: string | null;
    provider: string;
    userPrefix: string | null;
  } | null;

  if (!metadata)
    throw new Error(`Account not found in Chrome extension: ${email}`);

  const isMicrosoft = metadata.provider === "microsoft";

  // 2. Set up CDP Fetch interception on service worker to capture backend tokens
  const captured: CapturedToken[] = [];
  const { Fetch } = swClient;
  await Fetch.enable({
    patterns: [{ urlPattern: "*superhuman.com/~backend*" }],
  });

  const handler = async ({ requestId, request }: any) => {
    const auth = request.headers["Authorization"] || "";
    if (auth.startsWith("Bearer ")) {
      captured.push({
        url: request.url,
        token: auth.slice(7),
        email: request.headers["x-superhuman-user-email"] || "",
      });
    }
    try {
      await Fetch.continueRequest({ requestId });
    } catch (error) {
      log.error(`Failed to continue intercepted request: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  Fetch.requestPaused(handler);

  // 3. Navigate to account and reload to trigger API calls
  await mainClient.Page.navigate({
    url: `https://mail.superhuman.com/${email}`,
  });
  await new Promise((r) => setTimeout(r, 3000));
  await mainClient.Page.reload();

  // 4. Wait for backend tokens (up to 20 seconds)
  const deadline = Date.now() + 20_000;
  while (captured.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }

  await Fetch.disable();

  // 5. Select best backend token
  const bestToken = selectBestToken(captured, email);

  // 6. Capture OAuth access token (provider token) via a second interception pass
  let accessToken = "";
  let accessTokenExpires = Date.now() + 3600_000;
  const providerCapture: CapturedToken[] = [];

  await Fetch.enable({
    patterns: [
      {
        urlPattern: isMicrosoft
          ? "*graph.microsoft.com*"
          : "*googleapis.com*",
      },
    ],
  });
  const providerHandler = async ({ requestId, request }: any) => {
    const auth = request.headers["Authorization"] || "";
    if (auth.startsWith("Bearer ")) {
      providerCapture.push({
        url: request.url,
        token: auth.slice(7),
        email: "",
      });
    }
    try {
      await Fetch.continueRequest({ requestId });
    } catch (error) {
      log.error(`Failed to continue provider interception request: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  Fetch.requestPaused(providerHandler);

  // Trigger a lightweight API call via reload
  await mainClient.Page.reload();
  const providerDeadline = Date.now() + 15_000;
  while (providerCapture.length === 0 && Date.now() < providerDeadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  await Fetch.disable();

  if (providerCapture.length > 0) {
    accessToken = providerCapture[0]!.token;
    try {
      const payload = JSON.parse(
        Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString()
      );
      if (payload.exp) accessTokenExpires = payload.exp * 1000;
    } catch (error) {
      log.warn(`Failed to parse provider token expiry: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 7. Build TokenInfo
  const tokenInfo: TokenInfo = {
    accessToken,
    email,
    expires: accessTokenExpires,
    isMicrosoft,
    userId: metadata.userId ?? undefined,
    idToken: bestToken ?? undefined,
    idTokenExpires: bestToken
      ? (() => {
          try {
            const p = JSON.parse(
              Buffer.from(bestToken.split(".")[1] ?? "", "base64url").toString()
            );
            return p.exp ? p.exp * 1000 : undefined;
          } catch (error) {
            log.warn(`Failed to parse backend token expiry: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
          }
        })()
      : undefined,
    superhumanToken: bestToken
      ? {
          token: bestToken,
          expires: (() => {
            try {
              const p = JSON.parse(
                Buffer.from(bestToken.split(".")[1] ?? "", "base64url").toString()
              );
              return p.exp ? p.exp * 1000 : 0;
            } catch (error) {
              log.warn(`Failed to parse backend token expiry: ${error instanceof Error ? error.message : String(error)}`);
              return 0;
            }
          })(),
        }
      : undefined,
    userPrefix: metadata.userPrefix ?? undefined,
  };

  // Cache it
  setTokenInCache(email, tokenInfo);
  return tokenInfo;
}

// ============================================================================
// Superhuman Backend Token Extraction
// ============================================================================

/**
 * Extract Superhuman backend token via CDP.
 * The token is read from window.GoogleAccount.credential._authData.idToken.
 *
 * @param conn - Superhuman connection
 * @param email - Account email
 * @returns Superhuman token info
 */
export async function extractSuperhumanToken(
  conn: SuperhumanConnection,
  email: string
): Promise<SuperhumanTokenInfo> {
  const { Runtime } = conn;

  // Verify account exists and switch to it
  const accounts = await listAccounts(conn);
  const accountExists = accounts.some((a) => a.email === email);

  if (!accountExists) {
    const available = accounts.map((a) => a.email).join(", ");
    throw new Error(`Account not found: ${email}. Available: ${available}`);
  }

  // Switch to the target account
  const switchResult = await switchAccount(conn, email);
  if (!switchResult.success) {
    throw new Error(`Failed to switch to account: ${email}`);
  }

  // Wait for account to fully load
  await new Promise((r) => setTimeout(r, 1000));

  // Extract backend token (idToken is used for Superhuman backend API)
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const credential = ga?.credential;

          if (!credential) {
            return { error: "Credential not found" };
          }

          // The Superhuman backend uses idToken (JWT), not accessToken (OAuth)
          const authData = credential._authData;
          if (!authData) {
            return { error: "AuthData not found" };
          }

          // idToken is the Firebase/Google Identity token used for Superhuman backend
          if (authData.idToken) {
            return {
              token: authData.idToken,
              email: ga?.emailAddress || authData.emailAddress || '',
              accountId: ga?.accountId,
              expires: authData.expires
            };
          }

          return { error: "Could not extract idToken" };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  const value = result.result.value as SuperhumanTokenInfo | { error: string };

  if ("error" in value) {
    throw new Error(`Superhuman token extraction failed: ${value.error}`);
  }

  return value;
}

/**
 * Get Superhuman backend token for an account, using cache if available.
 *
 * @param conn - Superhuman connection
 * @param email - Account email
 * @returns Superhuman token info
 */
export async function getSuperhumanToken(
  conn: SuperhumanConnection,
  email: string
): Promise<SuperhumanTokenInfo> {
  // Check cache first
  const cached = superhumanTokenCache.get(email);

  if (cached) {
    // Check if token is expired (if we have expiry info)
    if (cached.expires) {
      const bufferMs = 5 * 60 * 1000; // 5 minutes
      if (cached.expires < Date.now() + bufferMs) {
        // Expired, fall through to extract fresh
      } else {
        return cached;
      }
    } else {
      // No expiry info, assume valid
      return cached;
    }
  }

  // Extract fresh token
  const token = await extractSuperhumanToken(conn, email);

  // Cache it
  superhumanTokenCache.set(email, token);

  return token;
}

/**
 * Clear the Superhuman token cache.
 */
export function clearSuperhumanTokenCache(): void {
  superhumanTokenCache.clear();
}

// ============================================================================
// User Prefix Extraction
// ============================================================================

/**
 * Extract the 4-character user prefix used for generating event IDs.
 *
 * The prefix is derived from the Superhuman userId (positions 7-10 of the
 * suffix after removing "user_").
 *
 * Extract using extractUserPrefix() from a Superhuman connection.
 */
export async function extractUserPrefix(
  conn: { Runtime: { evaluate: (opts: { expression: string; returnByValue: boolean }) => Promise<{ result: { value: any } }> } }
): Promise<string | null> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const userId = ga?.labels?._settings?._cache?.userId;
        if (!userId) return null;
        const suffix = userId.replace('user_', '');
        // The user prefix is at positions 7-10 of the suffix
        if (suffix.length < 11) return null;
        return suffix.substring(7, 11);
      })()
    `,
    returnByValue: true,
  });

  return result.result.value || null;
}
