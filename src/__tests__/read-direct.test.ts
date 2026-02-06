import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm } from "node:fs/promises";

const TEST_CONFIG_DIR = "/tmp/superhuman-cli-read-test";
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
    email: "test@example.com",
    expires: Date.now() + 3600000,
    isMicrosoft: false,
    ...overrides,
  };
}

describe("readThread direct API", () => {
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

  test("readThread returns messages from Gmail thread via API", async () => {
    const token = createTestToken();
    setTokenCacheForTest(token.email, token);
    const provider = new CachedTokenProvider(token.email);

    // Mock Gmail thread response
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: "thread123",
          messages: [
            {
              id: "msg1",
              snippet: "Hello there",
              payload: {
                headers: [
                  { name: "Subject", value: "Test Subject" },
                  { name: "From", value: "Alice <alice@example.com>" },
                  { name: "To", value: "Bob <bob@example.com>" },
                  { name: "Cc", value: "Charlie <charlie@example.com>" },
                  { name: "Date", value: "2025-02-04T10:00:00Z" },
                ],
              },
            },
            {
              id: "msg2",
              snippet: "Got it, thanks",
              payload: {
                headers: [
                  { name: "Subject", value: "Re: Test Subject" },
                  { name: "From", value: "Bob <bob@example.com>" },
                  { name: "To", value: "Alice <alice@example.com>" },
                  { name: "Cc", value: "" },
                  { name: "Date", value: "2025-02-04T11:00:00Z" },
                ],
              },
            },
          ],
        }),
        text: () => Promise.resolve(""),
      } as Response)
    ) as unknown as typeof fetch;

    const { readThread } = await import("../read");
    const messages = await readThread(provider, "thread123");

    expect(messages).toHaveLength(2);

    // First message
    expect(messages[0].id).toBe("msg1");
    expect(messages[0].threadId).toBe("thread123");
    expect(messages[0].subject).toBe("Test Subject");
    expect(messages[0].from.email).toBe("alice@example.com");
    expect(messages[0].from.name).toBe("Alice");
    expect(messages[0].to[0].email).toBe("bob@example.com");
    expect(messages[0].cc[0].email).toBe("charlie@example.com");
    expect(messages[0].snippet).toBe("Hello there");

    // Second message
    expect(messages[1].id).toBe("msg2");
    expect(messages[1].from.email).toBe("bob@example.com");
  });

  test("readThread returns messages from MS Graph conversation", async () => {
    const token = createTestToken({ isMicrosoft: true });
    setTokenCacheForTest(token.email, token);
    const provider = new CachedTokenProvider(token.email);

    // Mock MS Graph response
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          value: [
            {
              id: "msgA",
              conversationId: "convABC",
              subject: "Outlook Thread",
              from: { emailAddress: { address: "sender@outlook.com", name: "Sender" } },
              toRecipients: [{ emailAddress: { address: "receiver@outlook.com", name: "Receiver" } }],
              ccRecipients: [],
              receivedDateTime: "2025-02-04T10:00:00Z",
              bodyPreview: "Preview text",
            },
          ],
        }),
        text: () => Promise.resolve(""),
      } as Response)
    ) as unknown as typeof fetch;

    const { readThread } = await import("../read");
    const messages = await readThread(provider, "convABC");

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("msgA");
    expect(messages[0].subject).toBe("Outlook Thread");
    expect(messages[0].from.email).toBe("sender@outlook.com");
    expect(messages[0].snippet).toBe("Preview text");
  });

  test("readThread returns empty array when thread not found", async () => {
    const token = createTestToken();
    setTokenCacheForTest(token.email, token);
    const provider = new CachedTokenProvider(token.email);

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "thread404", messages: [] }),
        text: () => Promise.resolve(""),
      } as Response)
    ) as unknown as typeof fetch;

    const { readThread } = await import("../read");
    const messages = await readThread(provider, "thread404");
    expect(messages).toHaveLength(0);
  });
});
