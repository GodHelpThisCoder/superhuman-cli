/**
 * Integration tests for the MCP server runtime (src/index.ts --mcp):
 *
 *   A. The stdio handshake is INSTANT even when Superhuman is unavailable.
 *      (The old code awaited launchSuperhuman before connecting the transport,
 *      stalling the handshake 30-120s during app updates — clients timed out
 *      and respawned the server in a loop.)
 *   B. Orphan prevention: stdin EOF (client gone) exits the server promptly
 *      and releases the lifecycle lock.
 *   C. SIGTERM exits promptly. POSIX-only graceful assertions — see comment.
 *
 * SAFETY: these tests spawn the REAL server binary, so they must never touch
 * the real Superhuman app:
 *   - CDP_PORT=39333 (a high closed port; NEVER 9333, the live Superhuman)
 *   - CDP_HOST=127.0.0.2 — launchSuperhuman refuses to spawn anything when
 *     getCDPHost() !== "localhost", so even a leader in "down" state can only
 *     log a warning, never start the app.
 *   - SUPERHUMAN_CLI_CONFIG_DIR = fresh temp dir per test (isolated lockfile,
 *     logs, tokens), cleaned up in afterEach.
 */

import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Subprocess } from "bun";
import { tryAcquireLock, defaultLockDeps, type LockDeps } from "../lifecycle/lock";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const ENTRY = join(PROJECT_ROOT, "src", "index.ts");
const TEST_TIMEOUT_MS = 20_000; // Windows process spawn is slow — be generous

const INITIALIZE_REQUEST =
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    },
  }) + "\n";

type ServerProc = Subprocess<"pipe", "pipe", "pipe">;

const liveProcs: ServerProc[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const proc of liveProcs.splice(0)) {
    try {
      proc.kill();
      await proc.exited;
    } catch {
      // already dead
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function spawnServer(): { proc: ServerProc; dir: string; lockPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "shcli-mcp-rt-"));
  tempDirs.push(dir);
  const proc = Bun.spawn(["bun", ENTRY, "--mcp"], {
    cwd: PROJECT_ROOT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      SUPERHUMAN_CLI_CONFIG_DIR: dir,
      CDP_PORT: "39333", // closed port — NEVER 9333 (real Superhuman)
      CDP_HOST: "127.0.0.2", // makes launchSuperhuman refuse to spawn the app
      SUPERHUMAN_LOG_LEVEL: "error",
    },
  }) as ServerProc;
  liveProcs.push(proc);
  // Drain stderr continuously so a chatty child can never block on a full pipe
  void new Response(proc.stderr).text().catch(() => "");
  return { proc, dir, lockPath: join(dir, "lifecycle.lock") };
}

const TIMED_OUT = Symbol("timeout");

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Read newline-delimited stdout until a line containing `needle` arrives. */
async function readLineContaining(proc: ServerProc, needle: string, timeoutMs: number): Promise<string> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.includes(needle)) return line;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Timed out waiting for "${needle}". Buffered stdout: ${buf.slice(0, 500)}`);
      }
      const result = await withTimeout(reader.read(), remaining);
      if (result === TIMED_OUT) {
        throw new Error(`Timed out waiting for "${needle}". Buffered stdout: ${buf.slice(0, 500)}`);
      }
      if (result.done) {
        throw new Error(`stdout closed before "${needle}" arrived. Buffered: ${buf.slice(0, 500)}`);
      }
      buf += decoder.decode(result.value, { stream: true });
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // a read may still be pending after a timeout — the afterEach kill cleans up
    }
  }
}

/** Send the JSON-RPC initialize request and wait for the response line. */
async function handshake(proc: ServerProc): Promise<{ response: string; elapsedMs: number }> {
  const started = Date.now();
  proc.stdin.write(INITIALIZE_REQUEST);
  await proc.stdin.flush();
  const response = await readLineContaining(proc, "serverInfo", 15_000);
  return { response, elapsedMs: Date.now() - started };
}

/** Poll for the lifecycle lock file (leader acquisition is async wrt the test). */
async function waitForLock(lockPath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(lockPath)) {
    if (Date.now() > deadline) throw new Error(`Lock file never appeared at ${lockPath}`);
    await Bun.sleep(25);
  }
}

describe("MCP runtime (real server subprocess)", () => {
  test(
    "A: handshake completes in <5s with Superhuman unavailable",
    async () => {
      const { proc } = spawnServer();

      const { response, elapsedMs } = await handshake(proc);

      // The old code stalled here for 30-120s awaiting a Superhuman launch.
      // (elapsedMs includes bun process boot, so the bound is generous but
      // still an order of magnitude below the old stall.)
      expect(elapsedMs).toBeLessThan(5_000);

      const parsed = JSON.parse(response);
      expect(parsed.id).toBe(1);
      expect(parsed.result.serverInfo.name).toBe("superhuman-cli");
      expect(parsed.result.serverInfo.version).toBeString();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "B: stdin EOF exits the server (no orphan) and releases the lifecycle lock",
    async () => {
      const { proc, lockPath } = spawnServer();
      await handshake(proc);

      // Fresh config dir -> this instance must have become the lock leader
      await waitForLock(lockPath, 2_000);

      proc.stdin.end(); // simulate the MCP client (Claude Code session) dying

      const exitCode = await withTimeout(proc.exited, 3_000);
      expect(exitCode).not.toBe(TIMED_OUT); // would mean an orphaned server
      expect(exitCode).toBe(0); // graceful shutdown path
      expect(existsSync(lockPath)).toBe(false); // lock released on shutdown
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "C: SIGTERM exits the server promptly",
    async () => {
      const { proc, lockPath } = spawnServer();
      await handshake(proc);
      await waitForLock(lockPath, 2_000);

      proc.kill("SIGTERM");

      const exitCode = await withTimeout(proc.exited, 3_000);
      expect(exitCode).not.toBe(TIMED_OUT);

      if (process.platform !== "win32") {
        // POSIX: the SIGTERM handler runs shutdown() -> exit(0) + lock release.
        expect(exitCode).toBe(0);
        expect(existsSync(lockPath)).toBe(false);
      } else {
        // Windows has no SIGTERM delivery: Bun hard-terminates the process
        // (TerminateProcess), the handler never runs, and the lock file
        // survives. That is acceptable BY DESIGN — recovery is the dead-pid
        // staleness path: a new instance must be able to take the lock over
        // immediately. Assert exactly that instead.
        expect(existsSync(lockPath)).toBe(true);
        const deps: LockDeps = { ...defaultLockDeps(), lockPath: () => lockPath };
        expect(tryAcquireLock(deps)).toBe(true);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
