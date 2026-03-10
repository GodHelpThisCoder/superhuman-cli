/**
 * Tests for src/audit.ts — Mutation Audit Log
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logAudit, readAuditLog, type AuditEntry } from "../audit";

// ---------------------------------------------------------------------------
// Test isolation via SUPERHUMAN_CLI_CONFIG_DIR
// ---------------------------------------------------------------------------

let testDir: string;
const origEnv = process.env.SUPERHUMAN_CLI_CONFIG_DIR;

beforeEach(() => {
  testDir = join(tmpdir(), `audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  } catch {
    // ignore cleanup failures
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("logAudit", () => {
  it("writes a JSONL entry to audit.jsonl", async () => {
    await logAudit({
      tool: "superhuman_send",
      account: "test@example.com",
      action: "executed",
      args: { to: "bob@example.com", subject: "Hello" },
      result: "success",
      dryRun: false,
    });

    const logPath = join(testDir, "audit.jsonl");
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf-8").trim();
    const entry = JSON.parse(content) as AuditEntry;
    expect(entry.tool).toBe("superhuman_send");
    expect(entry.account).toBe("test@example.com");
    expect(entry.action).toBe("executed");
    expect(entry.result).toBe("success");
    expect(entry.timestamp).toBeTruthy();
    expect(entry.args.to).toBe("bob@example.com");
  });

  it("appends multiple entries (JSONL format)", async () => {
    await logAudit({
      tool: "superhuman_archive",
      account: "a@test.com",
      action: "executed",
      args: { threadIds: ["t1"] },
      result: "success",
      dryRun: false,
    });
    await logAudit({
      tool: "superhuman_delete",
      account: "a@test.com",
      action: "executed",
      args: { threadIds: ["t2"] },
      result: "success",
      dryRun: false,
    });

    const content = readFileSync(join(testDir, "audit.jsonl"), "utf-8").trim();
    const lines = content.split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).tool).toBe("superhuman_archive");
    expect(JSON.parse(lines[1]!).tool).toBe("superhuman_delete");
  });

  it("truncates body field to 200 characters", async () => {
    const longBody = "A".repeat(500);
    await logAudit({
      tool: "superhuman_send",
      account: "a@test.com",
      action: "executed",
      args: { body: longBody, to: "x@y.com" },
      result: "success",
      dryRun: false,
    });

    const content = readFileSync(join(testDir, "audit.jsonl"), "utf-8").trim();
    const entry = JSON.parse(content) as AuditEntry;
    expect((entry.args.body as string).length).toBe(203); // 200 + "..."
    expect((entry.args.body as string).endsWith("...")).toBe(true);
  });

  it("truncates attachment content fields", async () => {
    await logAudit({
      tool: "superhuman_send",
      account: "a@test.com",
      action: "executed",
      args: {
        attachments: [{ filename: "report.pdf", content: "A".repeat(500) }],
      },
      result: "success",
      dryRun: false,
    });

    const content = readFileSync(join(testDir, "audit.jsonl"), "utf-8").trim();
    const entry = JSON.parse(content) as AuditEntry;
    const attachments = entry.args.attachments as Array<{ content: string }>;
    expect(attachments[0]?.content.length).toBe(203);
    expect(attachments[0]?.content.endsWith("...")).toBe(true);
  });

  it("applies secure permissions to new log file", async () => {
    await logAudit({
      tool: "superhuman_send",
      account: "a@test.com",
      action: "executed",
      args: {},
      result: "success",
      dryRun: false,
    });

    if (process.platform !== "win32") {
      const mode = statSync(join(testDir, "audit.jsonl")).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("preserves short body fields", async () => {
    await logAudit({
      tool: "superhuman_send",
      account: "a@test.com",
      action: "executed",
      args: { body: "Short body" },
      result: "success",
      dryRun: false,
    });

    const content = readFileSync(join(testDir, "audit.jsonl"), "utf-8").trim();
    const entry = JSON.parse(content) as AuditEntry;
    expect(entry.args.body).toBe("Short body");
  });

  it("records error details", async () => {
    await logAudit({
      tool: "superhuman_send",
      account: "a@test.com",
      action: "executed",
      args: {},
      result: "error",
      error: "Connection refused",
      dryRun: false,
    });

    const content = readFileSync(join(testDir, "audit.jsonl"), "utf-8").trim();
    const entry = JSON.parse(content) as AuditEntry;
    expect(entry.result).toBe("error");
    expect(entry.error).toBe("Connection refused");
  });

  it("records batchSize and token fields", async () => {
    await logAudit({
      tool: "superhuman_archive",
      account: "a@test.com",
      action: "staged",
      args: { threadIds: ["t1", "t2", "t3"] },
      result: "success",
      batchSize: 3,
      token: "shm_abc123",
      dryRun: false,
    });

    const content = readFileSync(join(testDir, "audit.jsonl"), "utf-8").trim();
    const entry = JSON.parse(content) as AuditEntry;
    expect(entry.batchSize).toBe(3);
    expect(entry.token).toBe("shm_abc123");
    expect(entry.action).toBe("staged");
  });

  it("never throws even if directory is unwritable", async () => {
    // Point to an impossible path
    process.env.SUPERHUMAN_CLI_CONFIG_DIR = "/nonexistent/deeply/nested/path/that/should/fail";

    // Should not throw
    await logAudit({
      tool: "superhuman_send",
      account: "a@test.com",
      action: "executed",
      args: {},
      result: "success",
      dryRun: false,
    });

    // If we get here, the test passes
    expect(true).toBe(true);
  });

  it("creates config directory if it does not exist", async () => {
    const subDir = join(testDir, "sub", "dir");
    process.env.SUPERHUMAN_CLI_CONFIG_DIR = subDir;

    await logAudit({
      tool: "superhuman_send",
      account: "a@test.com",
      action: "executed",
      args: {},
      result: "success",
      dryRun: false,
    });

    expect(existsSync(join(subDir, "audit.jsonl"))).toBe(true);
  });

  it("rotates log file when it exceeds 10MB", async () => {
    const logPath = join(testDir, "audit.jsonl");
    // Create a file just over 10MB
    const bigContent = "x".repeat(10 * 1024 * 1024 + 1);
    writeFileSync(logPath, bigContent);

    await logAudit({
      tool: "superhuman_send",
      account: "a@test.com",
      action: "executed",
      args: {},
      result: "success",
      dryRun: false,
    });

    // Original should be rotated
    expect(existsSync(`${logPath}.1`)).toBe(true);
    // New entry should be in a fresh file
    const newContent = readFileSync(logPath, "utf-8").trim();
    const entry = JSON.parse(newContent) as AuditEntry;
    expect(entry.tool).toBe("superhuman_send");
  });
});

describe("readAuditLog", () => {
  it("returns empty array if no log file exists", async () => {
    const entries = await readAuditLog();
    expect(entries).toEqual([]);
  });

  it("reads entries from log file", async () => {
    await logAudit({
      tool: "superhuman_send",
      account: "a@test.com",
      action: "executed",
      args: {},
      result: "success",
      dryRun: false,
    });
    await logAudit({
      tool: "superhuman_archive",
      account: "b@test.com",
      action: "executed",
      args: {},
      result: "success",
      dryRun: false,
    });

    const entries = await readAuditLog();
    expect(entries.length).toBe(2);
    expect(entries[0]!.tool).toBe("superhuman_send");
    expect(entries[1]!.tool).toBe("superhuman_archive");
  });

  it("filters by tool name", async () => {
    await logAudit({ tool: "superhuman_send", account: "a@test.com", action: "executed", args: {}, result: "success", dryRun: false });
    await logAudit({ tool: "superhuman_archive", account: "a@test.com", action: "executed", args: {}, result: "success", dryRun: false });
    await logAudit({ tool: "superhuman_send", account: "a@test.com", action: "executed", args: {}, result: "error", dryRun: false });

    const entries = await readAuditLog({ tool: "superhuman_send" });
    expect(entries.length).toBe(2);
    expect(entries.every(e => e.tool === "superhuman_send")).toBe(true);
  });

  it("limits number of returned entries (most recent)", async () => {
    for (let i = 0; i < 10; i++) {
      await logAudit({
        tool: `tool_${i}`,
        account: "a@test.com",
        action: "executed",
        args: { index: i },
        result: "success",
        dryRun: false,
      });
    }

    const entries = await readAuditLog({ limit: 3 });
    expect(entries.length).toBe(3);
    // Should be the last 3 entries
    expect((entries[0]!.args as Record<string, number>).index).toBe(7);
    expect((entries[1]!.args as Record<string, number>).index).toBe(8);
    expect((entries[2]!.args as Record<string, number>).index).toBe(9);
  });

  it("skips malformed JSON lines", async () => {
    const logPath = join(testDir, "audit.jsonl");
    const validEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      tool: "superhuman_send",
      account: "a@test.com",
      action: "executed",
      args: {},
      result: "success",
      dryRun: false,
    });
    writeFileSync(logPath, `${validEntry}\nNOT_VALID_JSON\n${validEntry}\n`);

    const entries = await readAuditLog();
    expect(entries.length).toBe(2);
  });

  it("defaults to 50 entries limit", async () => {
    const logPath = join(testDir, "audit.jsonl");
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) {
      lines.push(JSON.stringify({
        timestamp: new Date().toISOString(),
        tool: "superhuman_send",
        account: "a@test.com",
        action: "executed",
        args: { index: i },
        result: "success",
        dryRun: false,
      }));
    }
    writeFileSync(logPath, lines.join("\n") + "\n");

    const entries = await readAuditLog();
    expect(entries.length).toBe(50);
    // Should be the last 50 (indices 10-59)
    expect((entries[0]!.args as Record<string, number>).index).toBe(10);
  });
});
