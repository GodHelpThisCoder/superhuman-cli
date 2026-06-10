/**
 * Native draft-store path coverage:
 *
 *   1. createDraftWithUserInfo (src/draft-api.ts) — exact request shape sent to
 *      Superhuman's /v3/userdata.writeMessage endpoint, and error mapping.
 *   2. draftHandler (src/mcp/tools/email-write.ts) — the full MCP happy path on
 *      cached credentials with ZERO CDP, pinning the review fix that the
 *      result reports BOTH "Draft ID:" and "Thread ID:" (the Superhuman store
 *      addresses drafts by (threadId, draftId) and has no programmatic
 *      delete/update, so threadId is the manual-recovery handle).
 *   3. getUserInfoFromProvider (src/mcp/tools/shared.ts) — a stale idToken must
 *      NOT be served from cache (the Superhuman backend would 401); it falls
 *      back to live CDP extraction.
 *
 * SAFETY: nothing here may touch the real Superhuman app.
 *   - CDP_HOST=127.0.0.2 is the authoritative guard: getCDPHost() is read at
 *     CALL time, so every CDP probe/connect targets a dead loopback alias and
 *     launchSuperhuman() refuses to spawn when the host isn't "localhost".
 *   - CDP_PORT=39333 is set as defense-in-depth only — shared.ts freezes
 *     CDP_PORT at first import (possibly by an earlier test file), so the env
 *     var cannot be relied on here; the host redirect can.
 *   - SUPERHUMAN_CLI_CONFIG_DIR points at a temp dir (isolated tokens, audit
 *     log, kill switch, lifecycle lock).
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDraftWithUserInfo, getUserInfoFromCache } from "../draft-api";
import { draftHandler } from "../mcp/tools/email-write";
import {
  getUserInfoFromProvider,
  warmResolvedEmailCache,
  invalidateCdpProvider,
} from "../mcp/tools/shared";
import { setTokenCacheForTest, clearTokenCache, type TokenInfo } from "../token-api";
import { LifecycleManager, setLifecycleManager } from "../lifecycle/manager";
import { STALE_AFTER_MS, type LockDeps } from "../lifecycle/lock";
import type { ConnectionProvider } from "../connection-provider";

const EMAIL = "draft-test@example.com";

// ---------------------------------------------------------------------------
// Environment isolation
// ---------------------------------------------------------------------------

const ENV_KEYS = ["CDP_HOST", "CDP_PORT", "SUPERHUMAN_CLI_CONFIG_DIR"] as const;
const origEnv: Record<string, string | undefined> = {};
let configDir: string;

beforeAll(() => {
  for (const k of ENV_KEYS) origEnv[k] = process.env[k];
  process.env.CDP_HOST = "127.0.0.2"; // never the real app (call-time guard)
  process.env.CDP_PORT = "39333"; // never 9333 (best-effort; see header)
  configDir = mkdtempSync(join(tmpdir(), "shcli-draft-"));
  process.env.SUPERHUMAN_CLI_CONFIG_DIR = configDir;
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k]!;
  }
  try {
    rmSync(configDir, { recursive: true, force: true });
  } catch {
    // audit-log write may still hold the dir on Windows — temp dir, harmless
  }
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokenCache();
  invalidateCdpProvider(); // drop warmed email + any cached CDP connection
  setLifecycleManager(null);
});

/** Install a mock fetch returning a canned response; returns the mock. */
function createMockFetch(response: { ok: boolean; status?: number; text?: string }) {
  const mockFn = mock(() =>
    Promise.resolve({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(response.text ?? "{}"),
    } as Response),
  );
  globalThis.fetch = mockFn as unknown as typeof fetch;
  return mockFn;
}

function freshToken(overrides?: Partial<TokenInfo>): TokenInfo {
  const now = Date.now();
  return {
    accessToken: "access-token-1",
    email: EMAIL,
    expires: now + 60 * 60 * 1000, // far future — CachedTokenProvider stays valid
    isMicrosoft: false,
    userId: "user-789",
    idToken: "id-token-xyz",
    idTokenExpires: now + 60 * 60 * 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. createDraftWithUserInfo — request shape
// ---------------------------------------------------------------------------

describe("createDraftWithUserInfo — request shape", () => {
  test("POSTs the draft write to userdata.writeMessage with Bearer idToken and DRAFT label", async () => {
    const mockFetch = createMockFetch({ ok: true });
    const userInfo = getUserInfoFromCache("user123", "sender@example.com", "idtoken-abc", "Test User");

    const result = await createDraftWithUserInfo(userInfo, {
      to: ["to@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      subject: "Native Draft",
      body: "<p>Hello</p>",
    });

    // Returned ids: draft00 + 14 hex chars; threadId is independently
    // generated for a new compose (NOT equal to draftId by construction).
    expect(result.success).toBe(true);
    expect(result.draftId).toMatch(/^draft00[0-9a-f]{14}$/);
    expect(result.threadId).toMatch(/^draft00[0-9a-f]{14}$/);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mail.superhuman.com/~backend/v3/userdata.writeMessage");
    expect(url).toContain("userdata.writeMessage");
    expect(init.method).toBe("POST");
    expect(init.headers).toHaveProperty("Authorization", "Bearer idtoken-abc");

    // Body: writes[0].path embeds users/{userId}/threads/{threadId}/messages/{draftId}/draft
    const body = JSON.parse(init.body as string);
    expect(body.writes).toHaveLength(1);
    expect(body.writes[0].path).toBe(
      `users/user123/threads/${result.threadId}/messages/${result.draftId}/draft`,
    );

    const value = body.writes[0].value;
    expect(value.id).toBe(result.draftId);
    expect(value.threadId).toBe(result.threadId);
    expect(value.labelIds).toContain("DRAFT");
    expect(value.action).toBe("compose");
    expect(value.to).toEqual(["to@example.com"]);
    expect(value.cc).toEqual(["cc@example.com"]);
    expect(value.bcc).toEqual(["bcc@example.com"]);
    expect(value.subject).toBe("Native Draft");
    expect(value.body).toBe("<p>Hello</p>");
    expect(value.from).toBe("Test User <sender@example.com>");
    expect(value.schemaVersion).toBe(3);
  });

  test("401 response maps to success:false with the status in the error", async () => {
    createMockFetch({ ok: false, status: 401, text: "Unauthorized" });
    const userInfo = getUserInfoFromCache("user123", "sender@example.com", "stale-token");

    const result = await createDraftWithUserInfo(userInfo, {
      to: ["to@example.com"],
      subject: "Doomed",
      body: "<p>x</p>",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
    expect(result.draftId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. draftHandler — happy path on cached credentials (zero CDP)
// ---------------------------------------------------------------------------

describe("draftHandler — native draft store via cached credentials", () => {
  beforeEach(() => {
    // Seed the token cache so getMcpProvider resolves a CachedTokenProvider
    // and getUserInfoFromProvider takes the cached (fresh idToken) branch.
    setTokenCacheForTest(EMAIL, freshToken());
    // Pre-warm the resolved-email cache so getMcpProvider's step-1 account
    // resolution (normally a live CDP query) is skipped entirely.
    warmResolvedEmailCache(EMAIL);
  });

  test("reports BOTH Draft ID and Thread ID on success (review fix)", async () => {
    const mockFetch = createMockFetch({ ok: true });

    const result = await draftHandler({ to: "rcpt@example.com", subject: "Hi there", body: "Body text" });

    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text;
    expect(text).toContain("Draft created in Superhuman's Drafts view");
    expect(text).toMatch(/Draft ID: draft00[0-9a-f]{14}/);
    expect(text).toMatch(/Thread ID: draft00[0-9a-f]{14}/); // the manual-recovery handle
    expect(text).toContain("To: rcpt@example.com");
    expect(text).toContain("Subject: Hi there");

    // Exactly one backend call, authorized with the cached idToken — proves
    // the whole path ran on cached credentials without CDP.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("userdata.writeMessage");
    expect(init.headers).toHaveProperty("Authorization", "Bearer id-token-xyz");
  });

  test("backend failure surfaces as an error result, not a fake success", async () => {
    createMockFetch({ ok: false, status: 401, text: "Unauthorized" });

    const result = await draftHandler({ to: "rcpt@example.com", subject: "Hi", body: "Body" });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Failed to create draft");
    expect(result.content[0]!.text).toContain("401");
  });
});

// ---------------------------------------------------------------------------
// 3. getUserInfoFromProvider — stale idToken contract
// ---------------------------------------------------------------------------

function stubProvider(token: TokenInfo): ConnectionProvider {
  return {
    getToken: async () => token,
    getCurrentEmail: async () => token.email,
    getAccountInfo: async () => ({ email: token.email, isMicrosoft: false, provider: "google" as const }),
    disconnect: async () => {},
  };
}

describe("getUserInfoFromProvider — stale idToken falls back to CDP", () => {
  test("fresh idToken: served from cache with the stub's values (no CDP)", async () => {
    // CDP_HOST points at a dead address — if this path touched CDP at all it
    // would reject, so resolving IS the no-CDP assertion.
    const token = freshToken({ userId: "u1", idToken: "fresh-token" });

    const info = await getUserInfoFromProvider(stubProvider(token));

    expect(info.userId).toBe("u1");
    expect(info.token).toBe("fresh-token");
    expect(info.email).toBe(EMAIL);
  });

  test("missing idTokenExpires is treated as fresh (legacy tokens)", async () => {
    const token = freshToken({ userId: "u2", idToken: "no-expiry-token", idTokenExpires: undefined });

    const info = await getUserInfoFromProvider(stubProvider(token));

    expect(info.userId).toBe("u2");
    expect(info.token).toBe("no-expiry-token");
  });

  test("stale idToken: cached branch is SKIPPED and the CDP fallback is attempted", async () => {
    // Full CDP extraction can't run in unit tests. Instead make the fallback
    // fail FAST and assert the rejection: a fail-fast LifecycleManager is
    // registered so getCdpConnection's launch policy errors immediately
    // (cdpProbe false + launch fails -> retryable lifecycle error), and
    // CDP_HOST=127.0.0.2 keeps the pre-policy probe off the real app.
    const dir = mkdtempSync(join(tmpdir(), "shcli-draft-lc-"));
    const lockDeps: LockDeps = {
      now: Date.now,
      pidAlive: () => true,
      lockPath: () => join(dir, "lifecycle.lock"),
      staleAfterMs: STALE_AFTER_MS,
    };
    const manager = new LifecycleManager(39333, {
      cdpProbe: async () => false,
      processProbe: async () => false,
      updaterProbe: async () => false,
      launch: async () => false,
      now: Date.now,
      lockDeps,
      readyWaitMs: 50,
    });
    setLifecycleManager(manager);
    invalidateCdpProvider(); // ensure no previously cached CDP connection short-circuits

    try {
      const stale = freshToken({
        userId: "u3",
        idToken: "stale-token",
        idTokenExpires: Date.now() - 1_000, // expired -> backend would 401
      });

      // The stub's userId+idToken are present, so a regression that trusts
      // them would RESOLVE with "stale-token". The contract: it must instead
      // go to CDP, which is unavailable here -> rejection.
      await expect(getUserInfoFromProvider(stubProvider(stale))).rejects.toThrow(/Superhuman/);
    } finally {
      setLifecycleManager(null);
      manager.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
