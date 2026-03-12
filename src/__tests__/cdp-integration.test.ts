// src/__tests__/cdp-integration.test.ts
// Integration tests that require Superhuman running with --remote-debugging-port=9333
// Run manually: bun test src/__tests__/cdp-integration.test.ts
//
// These tests are SKIPPED in CI and normal `bun test` runs.
// They exercise CDP-dependent functionality: account listing/switching, MCP handlers.
import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import {
  connectToSuperhuman,
  disconnect,
  type SuperhumanConnection,
} from "../superhuman-api";
import { listAccounts, switchAccount } from "../accounts";
import { accountsHandler, switchAccountHandler } from "../mcp/tools";
import { confirmHandler } from "../mcp/tools/confirm";
import { _clearStaged } from "../mcp/confirmation";

const CDP_PORT = 9333;

// Skip all tests if Superhuman is not running
let conn: SuperhumanConnection | null = null;
let skip = false;

beforeAll(async () => {
  try {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) skip = true;
  } catch {
    skip = true;
  }
});

afterAll(async () => {
  if (conn) await disconnect(conn);
});

describe("accounts (CDP integration)", () => {
  test("listAccounts returns array of accounts", async () => {
    if (skip || !conn) return; // skip if no CDP

    const accounts = await listAccounts(conn);

    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.length).toBeGreaterThan(0);

    const account = accounts[0]!;
    expect(account).toHaveProperty("email");
    expect(account).toHaveProperty("isCurrent");
    expect(typeof account.email).toBe("string");
    expect(typeof account.isCurrent).toBe("boolean");
    expect(account.email).toContain("@");
  });

  test("exactly one account is marked as current", async () => {
    if (skip || !conn) return;

    const accounts = await listAccounts(conn);
    const currentAccounts = accounts.filter((a) => a.isCurrent);
    expect(currentAccounts.length).toBe(1);
  });

  test("switchAccount switches to a different account", async () => {
    if (skip || !conn) return;

    const accounts = await listAccounts(conn);
    if (accounts.length < 2) return; // need 2+ accounts

    const currentAccount = accounts.find((a) => a.isCurrent);
    const targetAccount = accounts.find((a) => !a.isCurrent);
    if (!currentAccount || !targetAccount) return;

    const result = await switchAccount(conn, targetAccount.email);
    expect(result.success).toBe(true);
    expect(result.email).toBe(targetAccount.email);

    const accountsAfter = await listAccounts(conn);
    const newCurrent = accountsAfter.find((a) => a.isCurrent);
    expect(newCurrent?.email).toBe(targetAccount.email);
  });

  test("switchAccount round-trip returns to original account", async () => {
    if (skip || !conn) return;

    const accounts = await listAccounts(conn);
    if (accounts.length < 2) return;

    const currentAccount = accounts.find((a) => a.isCurrent);
    const targetAccount = accounts.find((a) => !a.isCurrent);
    if (!currentAccount || !targetAccount) return;

    const result1 = await switchAccount(conn, targetAccount.email);
    expect(result1.success).toBe(true);

    const result2 = await switchAccount(conn, currentAccount.email);
    expect(result2.success).toBe(true);
    expect(result2.email).toBe(currentAccount.email);
  });
});

describe("MCP account handlers (CDP integration)", () => {
  describe("accountsHandler", () => {
    test("returns ToolResult with accounts list", async () => {
      if (skip) return;

      const result = await accountsHandler({});

      expect(result).toHaveProperty("content");
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0]!).toHaveProperty("type", "text");
      expect(result.isError).toBeUndefined();

      const text = result.content[0]!.text;
      expect(text).toContain("@");
    });

    test("marks current account in output", async () => {
      if (skip) return;

      const result = await accountsHandler({});
      const text = result.content[0]!.text;
      expect(text).toContain("(current)");
    });
  });

  describe("switchAccountHandler", () => {
    afterEach(() => _clearStaged());

    function extractToken(text: string): string {
      const match = text.match(/Confirm: (shm_[A-Za-z0-9_-]+)/);
      if (!match) throw new Error(`No token found in: ${text}`);
      return match[1]!;
    }

    test("switches account by email address", async () => {
      if (skip || !conn) return;

      const accounts = await listAccounts(conn);
      if (accounts.length < 2) return;

      const targetAccount = accounts.find((a) => !a.isCurrent);
      if (!targetAccount) return;

      // Phase 1: stage
      const staged = await switchAccountHandler({ account: targetAccount.email });
      expect(staged.isError).toBeUndefined();
      expect(staged.content[0]!.text).toContain("STAGED");
      const token = extractToken(staged.content[0]!.text);

      // Phase 2: confirm
      const result = await confirmHandler({ token });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain("Switched to");
      expect(result.content[0]!.text).toContain(targetAccount.email);
    });

    test("switches account by index (1-based)", async () => {
      if (skip || !conn) return;

      const accounts = await listAccounts(conn);
      if (accounts.length < 2) return;

      const currentIndex = accounts.findIndex((a) => a.isCurrent);
      const targetIndex = currentIndex === 0 ? 2 : 1;
      const targetEmail = accounts[targetIndex - 1]!.email;

      // Phase 1: stage
      const staged = await switchAccountHandler({ account: String(targetIndex) });
      expect(staged.isError).toBeUndefined();
      expect(staged.content[0]!.text).toContain("STAGED");
      const token = extractToken(staged.content[0]!.text);

      // Phase 2: confirm
      const result = await confirmHandler({ token });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain("Switched to");
      expect(result.content[0]!.text).toContain(targetEmail);
    });

    test("returns error for invalid account identifier", async () => {
      if (skip) return;

      // Phase 1: staging succeeds (no input validation at stage time)
      const staged = await switchAccountHandler({ account: "nonexistent@example.com" });
      expect(staged.isError).toBeUndefined();
      const token = extractToken(staged.content[0]!.text);

      // Phase 2: confirmation executes and hits the validation error
      const result = await confirmHandler({ token });
      expect(result.isError).toBe(true);
    });

    test("returns error for out-of-range index", async () => {
      if (skip) return;

      // Phase 1: staging succeeds
      const staged = await switchAccountHandler({ account: "999" });
      expect(staged.isError).toBeUndefined();
      const token = extractToken(staged.content[0]!.text);

      // Phase 2: confirmation executes and hits the validation error
      const result = await confirmHandler({ token });
      expect(result.isError).toBe(true);
    });
  });
});
