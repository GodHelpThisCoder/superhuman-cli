// src/__tests__/reply-all-outlook-threading.test.ts
// Regression test for GitHub Issue #15:
// reply-all threading failure for Outlook/Exchange accounts when the thread
// is older than the 50 most recent messages.
import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";

import {
  getThreadInfoDirect,
  clearTokenCache,
  setTokenCacheForTest,
  type TokenInfo,
} from "../token-api";

function createOutlookToken(overrides: Partial<TokenInfo> = {}): TokenInfo {
  return {
    accessToken: "test-outlook-token",
    email: "user@outlook.com",
    expires: Date.now() + 3600000,
    isMicrosoft: true,
    ...overrides,
  };
}

// Build a fake MS Graph message with internet message headers
function makeMsGraphMessage(opts: {
  id: string;
  conversationId: string;
  subject: string;
  from: string;
  to: string[];
  cc?: string[];
  messageId?: string;
  references?: string;
  receivedDateTime?: string;
}) {
  const headers: Array<{ name: string; value: string }> = [];
  if (opts.messageId) {
    headers.push({ name: "Message-ID", value: opts.messageId });
  }
  if (opts.references) {
    headers.push({ name: "References", value: opts.references });
  }

  return {
    id: opts.id,
    conversationId: opts.conversationId,
    subject: opts.subject,
    from: { emailAddress: { address: opts.from, name: opts.from } },
    toRecipients: opts.to.map((addr) => ({
      emailAddress: { address: addr, name: addr },
    })),
    ccRecipients: (opts.cc || []).map((addr) => ({
      emailAddress: { address: addr, name: addr },
    })),
    internetMessageHeaders: headers,
    receivedDateTime: opts.receivedDateTime || "2026-02-27T10:00:00Z",
  };
}

describe("getThreadInfoDirect MS Graph fallback (Issue #15)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearTokenCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearTokenCache();
  });

  test("falls back to direct message fetch when threadId is a message ID not in top 50", async () => {
    const token = createOutlookToken();
    setTokenCacheForTest(token.email, token);

    const targetMessageId = "AAMkAGI2TARGET_MSG_ID";
    const targetConversationId = "AAQkAGI2CONV_OLD";

    // Build 50 unrelated recent messages (none match the target)
    const recentMessages = Array.from({ length: 50 }, (_, i) =>
      makeMsGraphMessage({
        id: `recent-msg-${i}`,
        conversationId: `AAQkAGI2CONV_RECENT_${i}`,
        subject: `Recent msg ${i}`,
        from: `sender${i}@example.com`,
        to: ["user@outlook.com"],
        receivedDateTime: new Date(Date.now() - i * 60000).toISOString(),
      })
    );

    // The target message (old, not in top 50)
    const targetMessage = makeMsGraphMessage({
      id: targetMessageId,
      conversationId: targetConversationId,
      subject: "Re: Old thread discussion",
      from: "alice@example.com",
      to: ["user@outlook.com", "bob@example.com"],
      cc: ["carol@example.com"],
      messageId: "<old-thread-msg@example.com>",
      references: "<original@example.com> <reply1@example.com>",
      receivedDateTime: "2026-01-15T08:00:00Z",
    });

    const fetchCalls: string[] = [];

    globalThis.fetch = mock(((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      fetchCalls.push(urlStr);

      // Filtered conversation query with a message-id thread token should return no matches.
      if (
        urlStr.includes("/me/messages?") &&
        urlStr.includes("conversationId") &&
        urlStr.includes(targetMessageId)
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ value: [] }),
          text: () => Promise.resolve(JSON.stringify({ value: [] })),
        } as Response);
      }

      // Fallback direct message lookup.
      if (urlStr.includes(`/me/messages/${targetMessageId}`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(targetMessage),
          text: () => Promise.resolve(JSON.stringify(targetMessage)),
        } as Response);
      }

      // Unexpected call
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "not found" }),
        text: () => Promise.resolve("not found"),
      } as Response);
    }) as typeof fetch) as unknown as typeof fetch;

    const result = await getThreadInfoDirect(token, targetMessageId);

    // Should NOT be null — the fallback should have found the message
    expect(result).not.toBeNull();
    expect(result!.subject).toBe("Re: Old thread discussion");
    expect(result!.from).toBe("alice@example.com");
    expect(result!.to).toContain("user@outlook.com");
    expect(result!.to).toContain("bob@example.com");
    expect(result!.cc).toContain("carol@example.com");
    expect(result!.messageId).toBe("<old-thread-msg@example.com>");
    expect(result!.references).toContain("<original@example.com>");
    expect(result!.references).toContain("<reply1@example.com>");
    expect(result!.references).toContain("<old-thread-msg@example.com>");

    // Verify the fallback fetch was actually called
    expect(fetchCalls.some((u) => u.includes(`/me/messages/${targetMessageId}`))).toBe(true);
  });

  test("still works when conversationId matches in top 50 (no fallback needed)", async () => {
    const token = createOutlookToken();
    setTokenCacheForTest(token.email, token);

    const targetConversationId = "AAQkAGI2CONV_RECENT";

    const matchingMessage = makeMsGraphMessage({
      id: "msg-in-top-50",
      conversationId: targetConversationId,
      subject: "Re: Recent discussion",
      from: "bob@example.com",
      to: ["user@outlook.com"],
      cc: ["dave@example.com"],
      messageId: "<recent-msg@example.com>",
      references: "<orig@example.com>",
      receivedDateTime: "2026-02-27T09:00:00Z",
    });

    const recentMessages = [
      matchingMessage,
      ...Array.from({ length: 49 }, (_, i) =>
        makeMsGraphMessage({
          id: `other-msg-${i}`,
          conversationId: `AAQkAGI2CONV_OTHER_${i}`,
          subject: `Other msg ${i}`,
          from: `sender${i}@example.com`,
          to: ["user@outlook.com"],
          receivedDateTime: new Date(Date.now() - (i + 1) * 60000).toISOString(),
        })
      ),
    ];

    globalThis.fetch = mock(((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (
        urlStr.includes("/me/messages?") &&
        urlStr.includes("conversationId") &&
        urlStr.includes(targetConversationId)
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ value: [matchingMessage] }),
          text: () => Promise.resolve(JSON.stringify({ value: [matchingMessage] })),
        } as Response);
      }

      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "not found" }),
        text: () => Promise.resolve("not found"),
      } as Response);
    }) as typeof fetch) as unknown as typeof fetch;

    const result = await getThreadInfoDirect(token, targetConversationId);

    expect(result).not.toBeNull();
    expect(result!.subject).toBe("Re: Recent discussion");
    expect(result!.from).toBe("bob@example.com");
    expect(result!.to).toContain("user@outlook.com");
    expect(result!.cc).toContain("dave@example.com");
  });

  test("paginates filtered conversation results when Graph returns nextLink", async () => {
    const token = createOutlookToken();
    setTokenCacheForTest(token.email, token);

    const targetConversationId = "AAQkAGI2CONV_PAGINATED";
    const fetchCalls: string[] = [];

    const firstPage = Array.from({ length: 50 }, (_, i) =>
      makeMsGraphMessage({
        id: `page-1-msg-${i}`,
        conversationId: targetConversationId,
        subject: `Page 1 message ${i}`,
        from: `sender${i}@example.com`,
        to: ["user@outlook.com"],
        receivedDateTime: new Date(Date.now() - (i + 1) * 60000).toISOString(),
      })
    );

    const secondPage = [
      makeMsGraphMessage({
        id: "page-2-msg-0",
        conversationId: targetConversationId,
        subject: "Page 2 message",
        from: "older@example.com",
        to: ["user@outlook.com"],
        receivedDateTime: "2026-01-01T00:00:00Z",
      }),
    ];

    globalThis.fetch = mock(((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      fetchCalls.push(urlStr);

      if (urlStr.includes("$filter=conversationId eq")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            value: firstPage,
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc123",
          }),
          text: () => Promise.resolve(JSON.stringify({
            value: firstPage,
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc123",
          })),
        } as Response);
      }

      if (urlStr.includes("$skiptoken=abc123")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ value: secondPage }),
          text: () => Promise.resolve(JSON.stringify({ value: secondPage })),
        } as Response);
      }

      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "not found" }),
        text: () => Promise.resolve("not found"),
      } as Response);
    }) as typeof fetch) as unknown as typeof fetch;

    const result = await getThreadInfoDirect(token, targetConversationId);

    expect(result).not.toBeNull();
    expect(fetchCalls.some((u) => u.includes("$skiptoken=abc123"))).toBe(true);
  });

  test("returns null when threadId matches neither conversationId nor message ID", async () => {
    const token = createOutlookToken();
    setTokenCacheForTest(token.email, token);

    globalThis.fetch = mock(((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      // Filtered conversation query returns no matches.
      if (
        urlStr.includes("/me/messages?") &&
        urlStr.includes("conversationId") &&
        urlStr.includes("nonexistent-id-xyz")
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ value: [] }),
          text: () => Promise.resolve(JSON.stringify({ value: [] })),
        } as Response);
      }

      // Fallback direct message fetch — 404
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () => Promise.resolve({ error: { code: "ErrorItemNotFound" } }),
        text: () => Promise.resolve("Not Found"),
      } as Response);
    }) as typeof fetch) as unknown as typeof fetch;

    const result = await getThreadInfoDirect(token, "nonexistent-id-xyz");

    expect(result).toBeNull();
  });
});
