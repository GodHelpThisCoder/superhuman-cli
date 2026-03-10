/**
 * Tests for kill switch functionality.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// Set up isolated config dir before importing modules that use it
const testConfigDir = join(tmpdir(), `shcli-test-${randomBytes(4).toString("hex")}`);
process.env.SUPERHUMAN_CLI_CONFIG_DIR = testConfigDir;

import { isKilled, activate, deactivate } from "../kill-switch";
import { guardMutation } from "../mcp/tools/shared";

describe("kill-switch", () => {
  beforeEach(() => {
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  test("isKilled returns false when no kill-switch file exists", () => {
    const result = isKilled();
    expect(result.killed).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  test("activate creates kill-switch file", () => {
    activate();
    expect(existsSync(join(testConfigDir, "kill-switch"))).toBe(true);
    const result = isKilled();
    expect(result.killed).toBe(true);
  });

  test("activate with reason stores reason in file", () => {
    activate("investigating batch delete");
    const result = isKilled();
    expect(result.killed).toBe(true);
    expect(result.reason).toBe("investigating batch delete");
  });

  test("deactivate removes kill-switch file", () => {
    activate("test");
    expect(isKilled().killed).toBe(true);

    deactivate();
    expect(isKilled().killed).toBe(false);
    expect(existsSync(join(testConfigDir, "kill-switch"))).toBe(false);
  });

  test("deactivate is safe when no kill-switch file exists", () => {
    // Should not throw
    deactivate();
    expect(isKilled().killed).toBe(false);
  });

  test("activate creates config dir if it does not exist", () => {
    rmSync(testConfigDir, { recursive: true, force: true });
    activate("creating dir");
    expect(existsSync(join(testConfigDir, "kill-switch"))).toBe(true);
    expect(isKilled().reason).toBe("creating dir");
  });
});

describe("guardMutation", () => {
  beforeEach(() => {
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  test("returns null when kill switch is not active", () => {
    expect(guardMutation()).toBeNull();
  });

  test("returns error result when kill switch is active", () => {
    activate();
    const result = guardMutation();
    expect(result).not.toBeNull();
    expect(result!.isError).toBe(true);
    expect(result!.content[0]!.text).toContain("KILLED");
  });

  test("includes reason in error when kill switch has reason", () => {
    activate("emergency stop");
    const result = guardMutation();
    expect(result!.content[0]!.text).toContain("emergency stop");
  });
});
