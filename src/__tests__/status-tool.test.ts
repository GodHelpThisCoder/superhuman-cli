/**
 * Unit tests for the superhuman_status MCP tool (src/mcp/tools/status.ts).
 *
 * statusHandler is read-only but performs a LIVE CDP probe
 * (isSuperhumanRunning), so the safety env applies:
 *   - CDP_HOST=127.0.0.2 — getCDPHost() is read at call time, so the probe
 *     targets a dead loopback alias and fails fast instead of touching the
 *     real app. (CDP_PORT=39333 is set as defense-in-depth, but shared.ts
 *     freezes CDP_PORT at first import — the host redirect is the real guard.)
 *   - The injected LifecycleManager never launches: its deps are fakes and
 *     its lock lives in a temp dir.
 */

import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { statusHandler } from "../mcp/tools/status";
import { LifecycleManager, setLifecycleManager } from "../lifecycle/manager";
import { STALE_AFTER_MS, type LockDeps } from "../lifecycle/lock";
import { APP_VERSION } from "../version";

const ENV_KEYS = ["CDP_HOST", "CDP_PORT"] as const;
const origEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) origEnv[k] = process.env[k];
  process.env.CDP_HOST = "127.0.0.2"; // live probe fails fast, never the real app
  process.env.CDP_PORT = "39333"; // never 9333
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k]!;
  }
});

afterEach(() => {
  setLifecycleManager(null); // never leak a manager into other test files
});

describe("statusHandler", () => {
  test("manager absent: reports version, pid, and 'lifecycle manager not running'", async () => {
    setLifecycleManager(null);

    const result = await statusHandler({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text;
    expect(text).toContain(`superhuman-cli MCP server v${APP_VERSION}`);
    expect(text).toContain(`(pid ${process.pid})`);
    expect(text).toContain("lifecycle manager not running");
    // The live probe against 127.0.0.2 must fail fast and report a
    // non-reachable verdict (isSuperhumanRunning swallows errors -> false).
    expect(text).toMatch(/CDP \(port \d+\): (unreachable|unknown \(probe failed\))/);
    expect(text).toContain("Pending update:");
    expect(text).toContain("superhuman doctor");
  });

  test("manager registered: reports lifecycle state, role, and leader pid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shcli-status-"));
    const lockDeps: LockDeps = {
      now: Date.now,
      pidAlive: () => true,
      lockPath: () => join(dir, "lifecycle.lock"),
      staleAfterMs: STALE_AFTER_MS,
    };
    const manager = new LifecycleManager(39333, {
      cdpProbe: async () => true, // keeps the manager in a clean "ready" state
      processProbe: async () => false,
      updaterProbe: async () => false,
      launch: async () => {
        throw new Error("status test manager must never launch");
      },
      now: Date.now,
      lockDeps,
      readyWaitMs: 50,
    });

    try {
      await manager.tickOnce(); // empty lock dir -> becomes leader; cdpProbe true -> ready
      setLifecycleManager(manager);

      const result = await statusHandler({});

      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      expect(text).toContain("Lifecycle: state=ready");
      expect(text).toContain("role=leader");
      expect(text).toContain(`leaderPid=${process.pid}`);
      expect(text).not.toContain("lifecycle manager not running");
    } finally {
      setLifecycleManager(null);
      manager.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
