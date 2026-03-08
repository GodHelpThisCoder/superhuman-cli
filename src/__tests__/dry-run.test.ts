/**
 * Tests for dry-run mode across all mutating handlers.
 *
 * Verifies that passing { dryRun: true } returns a preview without executing,
 * and that dry-run works even when the kill switch is active.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Handler imports
import { draftHandler, sendHandler, replyHandler, replyAllHandler, forwardHandler } from "../mcp/tools/email-write";
import { archiveHandler, deleteHandler, markReadHandler, markUnreadHandler, starHandler, unstarHandler, snoozeHandler, unsnoozeHandler } from "../mcp/tools/email-manage";
import { askAIHandler } from "../mcp/tools/ai";

// Kill switch helpers
import { activate as killActivate, deactivate as killDeactivate } from "../kill-switch";

// ---------------------------------------------------------------------------
// Test isolation
// ---------------------------------------------------------------------------

let testDir: string;
const origEnv = process.env.SUPERHUMAN_CLI_CONFIG_DIR;

beforeEach(() => {
  testDir = join(tmpdir(), `dryrun-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.SUPERHUMAN_CLI_CONFIG_DIR = testDir;
});

afterEach(() => {
  if (origEnv === undefined) {
    delete process.env.SUPERHUMAN_CLI_CONFIG_DIR;
  } else {
    process.env.SUPERHUMAN_CLI_CONFIG_DIR = origEnv;
  }
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Email write handlers
// ---------------------------------------------------------------------------

describe("dry-run: email write handlers", () => {
  it("draftHandler returns preview without executing", async () => {
    const result = await draftHandler({ to: "a@b.com", subject: "Test", body: "Hi", dryRun: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("a@b.com");
    expect(result.content[0]!.text).toContain("Test");
  });

  it("sendHandler returns preview without executing", async () => {
    const result = await sendHandler({ to: "a@b.com", subject: "Test", body: "Hi", dryRun: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("send");
  });

  it("replyHandler returns preview without executing", async () => {
    const result = await replyHandler({ threadId: "t1", body: "Hi", send: true, dryRun: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("send");
    expect(result.content[0]!.text).toContain("t1");
  });

  it("replyAllHandler returns preview without executing", async () => {
    const result = await replyAllHandler({ threadId: "t1", body: "Hi", dryRun: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("reply-all");
  });

  it("forwardHandler returns preview without executing", async () => {
    const result = await forwardHandler({ threadId: "t1", toEmail: "b@c.com", body: "Fwd", send: true, dryRun: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("b@c.com");
  });
});

// ---------------------------------------------------------------------------
// Email manage handlers
// ---------------------------------------------------------------------------

describe("dry-run: email manage handlers", () => {
  it("archiveHandler returns preview", async () => {
    const result = await archiveHandler({ threadIds: ["t1", "t2"], dryRun: true });
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("2 thread(s)");
  });

  it("deleteHandler returns preview", async () => {
    const result = await deleteHandler({ threadIds: ["t1"], dryRun: true });
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("1 thread(s)");
  });

  it("markReadHandler returns preview", async () => {
    const result = await markReadHandler({ threadIds: ["t1"], dryRun: true });
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("read");
  });

  it("markUnreadHandler returns preview", async () => {
    const result = await markUnreadHandler({ threadIds: ["t1"], dryRun: true });
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("unread");
  });

  it("starHandler returns preview", async () => {
    const result = await starHandler({ threadIds: ["t1"], dryRun: true });
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("star");
  });

  it("unstarHandler returns preview", async () => {
    const result = await unstarHandler({ threadIds: ["t1"], dryRun: true });
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("unstar");
  });

  it("snoozeHandler returns preview", async () => {
    const result = await snoozeHandler({ threadIds: ["t1"], until: "tomorrow", dryRun: true });
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("snooze");
  });

  it("unsnoozeHandler returns preview", async () => {
    const result = await unsnoozeHandler({ threadIds: ["t1"], dryRun: true });
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("unsnooze");
  });
});

// ---------------------------------------------------------------------------
// AI handler
// ---------------------------------------------------------------------------

describe("dry-run: AI handler", () => {
  it("askAIHandler returns preview", async () => {
    const result = await askAIHandler({ query: "What emails did John send?", dryRun: true });
    expect(result.content[0]!.text).toContain("[DRY RUN]");
    expect(result.content[0]!.text).toContain("What emails did John send?");
  });
});

// ---------------------------------------------------------------------------
// Dry-run works when kill switch is active
// ---------------------------------------------------------------------------

describe("dry-run bypasses kill switch", () => {
  it("returns preview even when killed", async () => {
    killActivate("test kill");

    const result = await sendHandler({ to: "a@b.com", subject: "Test", body: "Hi", dryRun: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("[DRY RUN]");

    killDeactivate();
  });

  it("kill switch blocks when NOT dry-run", async () => {
    killActivate("test kill");

    // Without dry-run, the handler should be killed (it won't reach provider)
    const result = await sendHandler({ to: "a@b.com", subject: "Test", body: "Hi" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("KILLED");

    killDeactivate();
  });
});
