/**
 * Regression tests for the 401→empty-page silent-truncation fix.
 *
 * Contract under test: search functions must THROW an isAuthError-matching
 * error on auth failure instead of returning { threads: [] }. An empty
 * return is indistinguishable from end-of-results to paginateSearchAll,
 * which silently truncates bulk operations (archive_by_query,
 * add_label_by_query, collect_thread_ids, sender_summary).
 *
 * The full refresh-and-retry loop (paginateSearchAll → getMcpProvider) is
 * not unit-testable here because getMcpProvider requires a live CDP
 * connection; these tests pin the throw side of the contract, and
 * isAuthError recognition pins the routing side.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { searchGmail, searchMSGraph } from "../api/gmail-client";
import { searchInbox } from "../inbox";
import { isAuthError } from "../mcp/tools/shared";
import type { TokenInfo } from "../auth/types";

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

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("searchGmail auth-error contract", () => {
  test("throws an isAuthError-matching error when the message list returns 401", async () => {
    mockFetchSequence([{ status: 401 }]);
    let thrown: unknown;
    try {
      await searchGmail(gmailToken, "from:someone", 10);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("401");
    expect(isAuthError(thrown)).toBe(true);
  });

  test("still returns empty threads (not an error) on a genuine empty result", async () => {
    mockFetchSequence([{ status: 200, body: { resultSizeEstimate: 0 } }]);
    const result = await searchGmail(gmailToken, "from:nobody", 10);
    expect(result.threads).toEqual([]);
    expect(result.totalResults).toBe(0);
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
      await searchGmail(gmailToken, "from:someone", 10);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(isAuthError(thrown)).toBe(true);
  });
});

describe("searchMSGraph auth-error contract", () => {
  test("throws an isAuthError-matching error on 401", async () => {
    mockFetchSequence([{ status: 401 }]);
    let thrown: unknown;
    try {
      await searchMSGraph(msToken, "from:someone", 10);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(isAuthError(thrown)).toBe(true);
  });

  test("still returns empty threads on a genuine empty result", async () => {
    mockFetchSequence([{ status: 200, body: { value: [] } }]);
    const result = await searchMSGraph(msToken, "from:nobody", 10);
    expect(result.threads).toEqual([]);
  });
});

describe("searchInbox MS Graph inbox branch (inline fetch)", () => {
  const msProvider = { getToken: async () => msToken } as unknown as Parameters<typeof searchInbox>[0];

  test("throws an isAuthError-matching error on 401 instead of returning empty", async () => {
    mockFetchSequence([{ status: 401 }]);
    let thrown: unknown;
    try {
      await searchInbox(msProvider, { query: "report", includeDone: false });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("401");
    expect(isAuthError(thrown)).toBe(true);
  });

  test("throws on 500 (no silent truncation for server errors either)", async () => {
    mockFetchSequence([{ status: 500 }]);
    let thrown: unknown;
    try {
      await searchInbox(msProvider, { query: "report", includeDone: false });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("500");
  });

  test("still returns empty threads on a genuine empty result", async () => {
    mockFetchSequence([{ status: 200, body: { value: [] } }]);
    const result = await searchInbox(msProvider, { query: "report", includeDone: false });
    expect(result.threads).toEqual([]);
  });
});
