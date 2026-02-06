import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm } from "node:fs/promises";

const TEST_CONFIG_DIR = "/tmp/superhuman-cli-reply-test";
process.env.SUPERHUMAN_CLI_CONFIG_DIR = TEST_CONFIG_DIR;

import { CachedTokenProvider } from "../connection-provider";
import {
  clearTokenCache,
  setTokenCacheForTest,
  type TokenInfo,
} from "../token-api";

function createTestToken(overrides: Partial<TokenInfo> = {}): TokenInfo {
  return {
    accessToken: "test-access-token",
    email: "me@example.com",
    expires: Date.now() + 3600000,
    isMicrosoft: false,
    ...overrides,
  };
}

describe("reply.ts with ConnectionProvider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    try { await rm(TEST_CONFIG_DIR, { recursive: true }); } catch {}
    await mkdir(TEST_CONFIG_DIR, { recursive: true });
    clearTokenCache();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    try { await rm(TEST_CONFIG_DIR, { recursive: true }); } catch {}
    clearTokenCache();
  });

  // Helper: mock multiple sequential fetch calls
  function mockFetchSequence(responses: Array<{ ok: boolean; data: unknown }>) {
    let callIndex = 0;
    globalThis.fetch = mock((() => {
      const resp = responses[callIndex] || responses[responses.length - 1];
      callIndex++;
      return Promise.resolve({
        ok: resp.ok,
        status: resp.ok ? 200 : 500,
        json: () => Promise.resolve(resp.data),
        text: () => Promise.resolve(JSON.stringify(resp.data)),
      } as Response);
    }) as typeof fetch) as unknown as typeof fetch;
  }

  test("replyToThread accepts ConnectionProvider and sends via API", async () => {
    const token = createTestToken();
    setTokenCacheForTest(token.email, token);
    const provider = new CachedTokenProvider(token.email);

    // Mock: 1st call = getThreadInfoDirect (for reply headers), 2nd call = send
    mockFetchSequence([
      { ok: true, data: { id: "thread1", messages: [{ id: "msg1", payload: { headers: [
        { name: "Subject", value: "Test" },
        { name: "From", value: "sender@example.com" },
        { name: "To", value: "me@example.com" },
        { name: "Message-ID", value: "<abc@mail>" },
        { name: "References", value: "" },
      ] } }] } },
      { ok: true, data: { id: "sent1", threadId: "thread1", labelIds: ["SENT"] } },
    ]);

    const { replyToThread } = await import("../reply");
    const result = await replyToThread(provider, "thread1", "Thanks!", true);
    expect(result.success).toBe(true);
  });

  test("replyAllToThread accepts ConnectionProvider", async () => {
    const token = createTestToken();
    setTokenCacheForTest(token.email, token);
    const provider = new CachedTokenProvider(token.email);

    mockFetchSequence([
      { ok: true, data: { id: "thread1", messages: [{ id: "msg1", payload: { headers: [
        { name: "Subject", value: "Test" },
        { name: "From", value: "sender@example.com" },
        { name: "To", value: "me@example.com, other@example.com" },
        { name: "Cc", value: "cc@example.com" },
        { name: "Message-ID", value: "<abc@mail>" },
        { name: "References", value: "" },
      ] } }] } },
      { ok: true, data: { id: "sent1", threadId: "thread1", labelIds: ["SENT"] } },
    ]);

    const { replyAllToThread } = await import("../reply");
    const result = await replyAllToThread(provider, "thread1", "Thanks all!", true);
    expect(result.success).toBe(true);
  });

  test("forwardThread accepts ConnectionProvider and builds forward content", async () => {
    const token = createTestToken();
    setTokenCacheForTest(token.email, token);
    const provider = new CachedTokenProvider(token.email);

    // Mock: 1st = thread info for forward headers, 2nd = thread messages for body, 3rd = send
    mockFetchSequence([
      { ok: true, data: { id: "thread1", messages: [{ id: "msg1", snippet: "original text", payload: {
        headers: [
          { name: "Subject", value: "Original Subject" },
          { name: "From", value: "Alice <alice@example.com>" },
          { name: "To", value: "me@example.com" },
          { name: "Date", value: "2025-02-04T10:00:00Z" },
          { name: "Message-ID", value: "<xyz@mail>" },
          { name: "References", value: "" },
        ],
        mimeType: "text/plain",
        body: { data: Buffer.from("Original email body text").toString("base64url") },
      } }] } },
      { ok: true, data: { id: "thread1", messages: [{ id: "msg1", snippet: "original text", payload: {
        headers: [{ name: "Subject", value: "Original Subject" }],
        mimeType: "text/plain",
        body: { data: Buffer.from("Original email body text").toString("base64url") },
      } }] } },
      { ok: true, data: { id: "sent1", threadId: "thread1", labelIds: ["SENT"] } },
    ]);

    const { forwardThread } = await import("../reply");
    const result = await forwardThread(provider, "thread1", "bob@example.com", "FYI see below", true);
    expect(result.success).toBe(true);
  });

  test("replyToThread creates draft when send=false", async () => {
    const token = createTestToken();
    setTokenCacheForTest(token.email, token);
    const provider = new CachedTokenProvider(token.email);

    // Mock: 1st = thread info, 2nd = create draft
    mockFetchSequence([
      { ok: true, data: { id: "thread1", messages: [{ id: "msg1", payload: { headers: [
        { name: "Subject", value: "Test" },
        { name: "From", value: "sender@example.com" },
        { name: "To", value: "me@example.com" },
        { name: "Message-ID", value: "<abc@mail>" },
      ] } }] } },
      { ok: true, data: { id: "draft1", message: { id: "msg2", threadId: "thread1" } } },
    ]);

    const { replyToThread } = await import("../reply");
    const result = await replyToThread(provider, "thread1", "Draft reply", false);
    expect(result.success).toBe(true);
  });
});
