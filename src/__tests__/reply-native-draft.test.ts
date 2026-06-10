/**
 * Native reply/forward draft coverage (the re-point of no-send mode from
 * provider drafts — invisible in Superhuman — to Superhuman's own store):
 *
 *   1. replyToThread / replyAllToThread / forwardThread (src/reply.ts) with a
 *      userInfo argument and a Gmail token write the draft to
 *      /v3/userdata.writeMessage, threaded onto the REAL thread:
 *      action reply/forward, inReplyToThreadId, inReplyToRfc822Id, the full
 *      references chain, mirrored recipient logic (reply-all excludes self
 *      case-insensitively), and Re:/Fwd: subject prefixes.
 *   2. Fallbacks preserved: Microsoft tokens and absent userInfo keep the
 *      provider-draft path and never touch the Superhuman backend.
 *   3. Handler guard: reply with attachments and no send:true is refused
 *      (a provider attachment draft would be invisible in Superhuman).
 *
 * Live-verified 2026-06-09: a draft created this way appeared inline on the
 * real thread in the app (editable, sendable). These tests pin the request
 * shape that verification observed.
 *
 * SAFETY: CDP_HOST=127.0.0.2 + temp config dir, same as draft-native-path.
 */

import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { replyToThread, replyAllToThread, forwardThread } from "../reply";
import type { UserInfo } from "../draft-api";
import { replyHandler } from "../mcp/tools/email-write";
import { warmResolvedEmailCache, invalidateCdpProvider } from "../mcp/tools/shared";
import { setTokenCacheForTest, clearTokenCache, type TokenInfo } from "../token-api";
import type { ConnectionProvider } from "../connection-provider";

const SELF = "shawn-test@example.com";
const THREAD_ID = "abc123def456";

// ---------------------------------------------------------------------------
// Environment isolation (same pattern as draft-native-path.test.ts)
// ---------------------------------------------------------------------------

const ENV_KEYS = ["CDP_HOST", "CDP_PORT", "SUPERHUMAN_CLI_CONFIG_DIR"] as const;
const origEnv: Record<string, string | undefined> = {};
let configDir: string;

beforeAll(() => {
  for (const k of ENV_KEYS) origEnv[k] = process.env[k];
  process.env.CDP_HOST = "127.0.0.2";
  process.env.CDP_PORT = "39333";
  configDir = mkdtempSync(join(tmpdir(), "shcli-reply-"));
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
    // Windows may hold the dir briefly — temp dir, harmless
  }
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokenCache();
  invalidateCdpProvider();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const b64url = (s: string) => Buffer.from(s).toString("base64url");

/** Gmail /threads/{id}?format=full response serving BOTH getThreadInfo and getThreadMessages. */
function threadFixture(subject = "Project update") {
  return {
    id: THREAD_ID,
    messages: [
      {
        id: "m1",
        internalDate: "1765000000000",
        snippet: "original snippet",
        labelIds: ["INBOX"],
        payload: {
          mimeType: "text/plain",
          body: { data: b64url("the original body") },
          headers: [
            { name: "Subject", value: subject },
            { name: "From", value: "Alice Example <alice@example.com>" },
            { name: "To", value: `Shawn <${SELF}>, Bob <bob@example.com>` },
            { name: "Cc", value: "carol@example.com" },
            { name: "Date", value: "Fri, 5 Jun 2026 16:45:26 -0400" },
            { name: "Message-ID", value: "<orig-msg@id.example>" },
            { name: "References", value: "<earlier@id.example>" },
          ],
        },
      },
    ],
  };
}

interface RoutedCall {
  url: string;
  init?: RequestInit;
}

/**
 * URL-routing mock fetch. Returns the call log so tests can assert which
 * backends were hit and inspect request bodies.
 */
function installFetchRouter(opts?: { subject?: string }) {
  const calls: RoutedCall[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, statusText: "OK" });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });

    if (url.includes("userdata.writeMessage")) return json({});
    if (url.includes(`/threads/${THREAD_ID}`)) return json(threadFixture(opts?.subject));
    if (url.includes("graph.microsoft.com")) {
      if (url.includes("$filter=conversationId")) return json({ value: [{ id: "ms-msg-1" }] });
      if (url.endsWith("/createReply") || url.endsWith("/createReplyAll")) return json({ id: "ms-draft-1" });
      return json({});
    }
    if (url.includes("/drafts")) return json({ id: "gmail-draft-1", message: { id: "gm1" } });
    return json({});
  }) as unknown as typeof fetch;

  return calls;
}

function gmailToken(): TokenInfo {
  const now = Date.now();
  return {
    accessToken: "access-1",
    email: SELF,
    expires: now + 3_600_000,
    isMicrosoft: false,
    userId: "user-1",
    idToken: "id-token-1",
    idTokenExpires: now + 3_600_000,
  } as TokenInfo;
}

function msToken(): TokenInfo {
  return { ...gmailToken(), isMicrosoft: true } as TokenInfo;
}

function providerStub(token: TokenInfo): ConnectionProvider {
  return {
    getToken: async () => token,
    getCurrentEmail: async () => token.email,
  } as unknown as ConnectionProvider;
}

const userInfo: UserInfo = {
  userId: "user-1",
  email: SELF,
  token: "id-token-1",
  timeZone: "America/Phoenix",
};

/** Extract the parsed writeMessage payload value (the draft object). */
function writeMessageDraft(calls: RoutedCall[]) {
  const wm = calls.filter((c) => c.url.includes("userdata.writeMessage"));
  expect(wm.length).toBe(1);
  const body = JSON.parse(String(wm[0]!.init?.body)) as {
    writes: Array<{ path: string; value: Record<string, unknown> }>;
  };
  expect(body.writes.length).toBe(1);
  return body.writes[0]!;
}

// ---------------------------------------------------------------------------
// 1. Native reply drafts — request shape
// ---------------------------------------------------------------------------

describe("replyToThread native draft (Gmail + userInfo)", () => {
  test("writes a threaded reply draft to the Superhuman store", async () => {
    const calls = installFetchRouter();
    const result = await replyToThread(providerStub(gmailToken()), THREAD_ID, "My reply text", false, userInfo);

    expect(result.success).toBe(true);
    expect(result.draftId).toStartWith("draft00");
    expect(result.threadId).toBe(THREAD_ID);

    const write = writeMessageDraft(calls);
    expect(write.path).toContain(`/threads/${THREAD_ID}/`);
    expect(write.value.action).toBe("reply");
    expect(write.value.threadId).toBe(THREAD_ID);
    expect(write.value.inReplyToRfc822Id).toBe("<orig-msg@id.example>");
    // getThreadInfo appends the last Message-ID — full RFC 5322 chain
    expect(write.value.references).toEqual(["<earlier@id.example>", "<orig-msg@id.example>"]);
    expect(write.value.to).toEqual(["alice@example.com"]);
    expect(write.value.subject).toBe("Re: Project update");
    expect(String(write.value.body)).toContain("My reply text");
  });

  test("does not double the Re: prefix", async () => {
    const calls = installFetchRouter({ subject: "Re: Project update" });
    const result = await replyToThread(providerStub(gmailToken()), THREAD_ID, "x", false, userInfo);
    expect(result.success).toBe(true);
    const write = writeMessageDraft(calls);
    expect(write.value.subject).toBe("Re: Project update");
  });
});

describe("replyAllToThread native draft", () => {
  test("addresses all recipients minus self (case-insensitive), cc preserved", async () => {
    const calls = installFetchRouter();
    const result = await replyAllToThread(providerStub(gmailToken()), THREAD_ID, "Reply all text", false, userInfo);

    expect(result.success).toBe(true);
    const write = writeMessageDraft(calls);
    expect(write.value.to).toEqual(["alice@example.com", "bob@example.com"]);
    expect(write.value.cc).toEqual(["carol@example.com"]);
  });
});

describe("forwardThread native draft", () => {
  test("writes a forward draft with Fwd: subject and forwarded-message block", async () => {
    const calls = installFetchRouter();
    const result = await forwardThread(
      providerStub(gmailToken()),
      THREAD_ID,
      "dest@example.com",
      "FYI",
      false,
      userInfo,
    );

    expect(result.success).toBe(true);
    expect(result.threadId).toBe(THREAD_ID);

    const write = writeMessageDraft(calls);
    expect(write.value.action).toBe("forward");
    expect(write.value.threadId).toBe(THREAD_ID);
    expect(write.value.to).toEqual(["dest@example.com"]);
    expect(write.value.subject).toBe("Fwd: Project update");
    const body = String(write.value.body);
    expect(body).toContain("Forwarded message");
    expect(body).toContain("the original body");
  });
});

// ---------------------------------------------------------------------------
// 2. Fallbacks — provider path preserved
// ---------------------------------------------------------------------------

describe("provider-draft fallbacks", () => {
  test("Microsoft token + userInfo never touches the Superhuman store", async () => {
    const calls = installFetchRouter();
    const result = await replyToThread(providerStub(msToken()), THREAD_ID, "ms reply", false, userInfo);

    expect(result.success).toBe(true);
    expect(result.draftId).toBe("ms-draft-1");
    expect(result.threadId).toBeUndefined();
    expect(calls.some((c) => c.url.includes("userdata.writeMessage"))).toBe(false);
    expect(calls.some((c) => c.url.includes("graph.microsoft.com"))).toBe(true);
  });

  test("Gmail token without userInfo keeps the provider draft path", async () => {
    const calls = installFetchRouter();
    const result = await replyToThread(providerStub(gmailToken()), THREAD_ID, "no userinfo", false);

    expect(result.success).toBe(true);
    expect(result.threadId).toBeUndefined();
    expect(calls.some((c) => c.url.includes("userdata.writeMessage"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/drafts"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Handler guard — attachments require send:true
// ---------------------------------------------------------------------------

describe("replyHandler attachment guard", () => {
  test("refuses attachments without send:true (would be an invisible provider draft)", async () => {
    installFetchRouter();
    setTokenCacheForTest(SELF, gmailToken());
    warmResolvedEmailCache(SELF);

    const result = await replyHandler({
      threadId: THREAD_ID,
      body: "with attachment",
      attachments: [{ filename: "a.txt", content: b64url("hi") }],
    } as Parameters<typeof replyHandler>[0]);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("send:true");
  });
});
