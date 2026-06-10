/**
 * Regression tests for listStarred masking auth failures.
 *
 * Contract under test: listStarred must THROW an isAuthError-matching error
 * on auth failure instead of returning []. An empty return is
 * indistinguishable from "no starred threads", so the starred MCP tool
 * reported "No starred threads found" when the real problem was an expired
 * token. starredHandler wraps the call in try/catch → actionableError, so a
 * throw degrades gracefully. Mirrors the PR #9 contract pinned in
 * search-auth-error.test.ts.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { listStarred } from "../labels";
import { isAuthError } from "../mcp/tools/shared";
import type { TokenInfo } from "../auth/types";
import type { ConnectionProvider } from "../connection-provider";

const originalFetch = globalThis.fetch;

function mockFetchSequence(responses: Array<{ status: number; body?: unknown }>) {
  let call = 0;
  globalThis.fetch = (async () => {
    const r = responses[Math.min(call, responses.length - 1)]!;
    call++;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status,
      statusText: r.status === 401 ? "Unauthorized" : r.status === 500 ? "Internal Server Error" : "OK",
    });
  }) as unknown as typeof fetch;
  return () => call;
}

const gmailToken = { accessToken: "expired-token", email: "t@example.com", isMicrosoft: false } as TokenInfo;
const msToken = { accessToken: "expired-token", email: "t@example.com", isMicrosoft: true } as TokenInfo;

const gmailProvider = { getToken: async () => gmailToken } as unknown as ConnectionProvider;
const msProvider = { getToken: async () => msToken } as unknown as ConnectionProvider;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("listStarred Gmail branch auth-error contract", () => {
  test("throws an isAuthError-matching error on 401 instead of returning []", async () => {
    mockFetchSequence([{ status: 401 }]);
    let thrown: unknown;
    try {
      await listStarred(gmailProvider, 10);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("401");
    expect(isAuthError(thrown)).toBe(true);
  });

  test("throws on 500 (server errors propagate too)", async () => {
    mockFetchSequence([{ status: 500 }]);
    let thrown: unknown;
    try {
      await listStarred(gmailProvider, 10);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("500");
  });

  test("still returns [] on a genuinely empty result", async () => {
    mockFetchSequence([{ status: 200, body: { resultSizeEstimate: 0 } }]);
    const result = await listStarred(gmailProvider, 10);
    expect(result).toEqual([]);
  });

  test("throws when a thread-detail fetch returns 401 mid-page (no silent drop)", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          messages: [{ id: "m1", threadId: "t1" }],
          resultSizeEstimate: 1,
        },
      },
      { status: 401 },
    ]);
    let thrown: unknown;
    try {
      await listStarred(gmailProvider, 10);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(isAuthError(thrown)).toBe(true);
  });
});

describe("listStarred MS Graph branch auth-error contract", () => {
  test("throws an isAuthError-matching error on 401 instead of returning []", async () => {
    mockFetchSequence([{ status: 401 }]);
    let thrown: unknown;
    try {
      await listStarred(msProvider, 10);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("401");
    expect(isAuthError(thrown)).toBe(true);
  });

  test("throws on 500 (server errors propagate too)", async () => {
    mockFetchSequence([{ status: 500 }]);
    let thrown: unknown;
    try {
      await listStarred(msProvider, 10);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("500");
  });

  test("still returns [] on a genuinely empty result", async () => {
    mockFetchSequence([{ status: 200, body: { value: [] } }]);
    const result = await listStarred(msProvider, 10);
    expect(result).toEqual([]);
  });

  test("dedupes flagged messages into unique conversation IDs", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          value: [
            { conversationId: "c1" },
            { conversationId: "c1" },
            { conversationId: "c2" },
          ],
        },
      },
    ]);
    const result = await listStarred(msProvider, 10);
    expect(result).toEqual([{ id: "c1" }, { id: "c2" }]);
  });
});
