import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm } from "node:fs/promises";

const TEST_CONFIG_DIR = "/tmp/superhuman-cli-migration-test";
process.env.SUPERHUMAN_CLI_CONFIG_DIR = TEST_CONFIG_DIR;

import { CachedTokenProvider } from "../connection-provider";
import {
  clearTokenCache,
  setTokenCacheForTest,
  type TokenInfo,
} from "../token-api";

// Create a valid token for tests
function createTestToken(overrides: Partial<TokenInfo> = {}): TokenInfo {
  return {
    accessToken: "test-access-token-123",
    email: "test@example.com",
    expires: Date.now() + 3600000,
    isMicrosoft: false,
    ...overrides,
  };
}

describe("Module migration to ConnectionProvider", () => {
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

  function mockFetchJson(data: unknown) {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(JSON.stringify(data)),
      } as Response)
    ) as unknown as typeof fetch;
  }

  describe("inbox.ts", () => {
    test("listInbox accepts ConnectionProvider", async () => {
      const token = createTestToken();
      setTokenCacheForTest(token.email, token);
      const provider = new CachedTokenProvider(token.email);

      // Mock Gmail API response
      mockFetchJson({
        threads: [{ id: "thread1", snippet: "test" }],
        resultSizeEstimate: 1,
      });

      const { listInbox } = await import("../inbox");
      // This should accept a ConnectionProvider now
      const result = await listInbox(provider, { limit: 5 });
      expect(Array.isArray(result)).toBe(true);
    });

    test("searchInbox accepts ConnectionProvider", async () => {
      const token = createTestToken();
      setTokenCacheForTest(token.email, token);
      const provider = new CachedTokenProvider(token.email);

      mockFetchJson({
        threads: [],
        resultSizeEstimate: 0,
      });

      const { searchInbox } = await import("../inbox");
      const result = await searchInbox(provider, { query: "test", limit: 5 });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("archive.ts", () => {
    test("archiveThread accepts ConnectionProvider", async () => {
      const token = createTestToken();
      setTokenCacheForTest(token.email, token);
      const provider = new CachedTokenProvider(token.email);

      mockFetchJson({ id: "thread1", labelIds: [] });

      const { archiveThread } = await import("../archive");
      const result = await archiveThread(provider, "thread1");
      expect(result).toBeDefined();
    });
  });

  describe("read-status.ts", () => {
    test("markAsRead accepts ConnectionProvider", async () => {
      const token = createTestToken();
      setTokenCacheForTest(token.email, token);
      const provider = new CachedTokenProvider(token.email);

      mockFetchJson({ id: "thread1" });

      const { markAsRead } = await import("../read-status");
      const result = await markAsRead(provider, "thread1");
      expect(result).toBeDefined();
    });
  });

  describe("contacts.ts", () => {
    test("searchContacts accepts ConnectionProvider", async () => {
      const token = createTestToken();
      setTokenCacheForTest(token.email, token);
      const provider = new CachedTokenProvider(token.email);

      mockFetchJson({
        results: [],
        totalPeople: 0,
      });

      const { searchContacts } = await import("../contacts");
      const result = await searchContacts(provider, "john", { limit: 5 });
      expect(Array.isArray(result)).toBe(true);
    });

    test("resolveRecipient accepts ConnectionProvider", async () => {
      const token = createTestToken();
      setTokenCacheForTest(token.email, token);
      const provider = new CachedTokenProvider(token.email);

      // Email address should pass through unchanged
      const { resolveRecipient } = await import("../contacts");
      const result = await resolveRecipient(provider, "already@email.com");
      expect(result).toBe("already@email.com");
    });
  });

  describe("labels.ts", () => {
    test("listLabels accepts ConnectionProvider", async () => {
      const token = createTestToken();
      setTokenCacheForTest(token.email, token);
      const provider = new CachedTokenProvider(token.email);

      mockFetchJson({ labels: [{ id: "INBOX", name: "INBOX" }] });

      const { listLabels } = await import("../labels");
      const result = await listLabels(provider);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("calendar.ts", () => {
    test("listEvents accepts ConnectionProvider", async () => {
      const token = createTestToken();
      setTokenCacheForTest(token.email, token);
      const provider = new CachedTokenProvider(token.email);

      mockFetchJson({ items: [] });

      const { listEvents } = await import("../calendar");
      const result = await listEvents(provider);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("attachments.ts", () => {
    test("listAttachments accepts ConnectionProvider", async () => {
      const token = createTestToken();
      setTokenCacheForTest(token.email, token);
      const provider = new CachedTokenProvider(token.email);

      // Mock Gmail thread response with no attachments
      mockFetchJson({
        id: "thread1",
        messages: [],
      });

      const { listAttachments } = await import("../attachments");
      const result = await listAttachments(provider, "thread1");
      expect(Array.isArray(result)).toBe(true);
    });

    test("addAttachment (CDP-only) should not exist", async () => {
      const mod = await import("../attachments");
      expect("addAttachment" in mod).toBe(false);
    });
  });
});
