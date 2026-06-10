/**
 * Tests for the lifecycle lockfile (src/lifecycle/lock.ts) — cooperative
 * leader election among concurrent MCP server instances.
 *
 * Unit tests use fully-injected LockDeps (fake clock, fake pidAlive, temp
 * lockPath) so no real time passes and no real pids are probed.
 *
 * Multi-process tests spawn the acquire-lock.ts fixture in real `bun`
 * subprocesses sharing one SUPERHUMAN_CLI_CONFIG_DIR to exercise the actual
 * create-exclusive race and dead-pid takeover.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  tryAcquireLock,
  heartbeatLock,
  releaseLock,
  verifyLockOwnership,
  readLock,
  isLockStale,
  defaultLockDeps,
  STALE_AFTER_MS,
  type LockDeps,
} from "../lifecycle/lock";

const FOREIGN_PID = 999_999; // never our own pid; liveness is injected anyway

interface TestLock {
  deps: LockDeps;
  lockPath: string;
  dir: string;
  /** Mutable fake clock — tests reassign `.t` to travel in time. */
  clock: { t: number };
  /** Mutable liveness flag consulted by the injected pidAlive. */
  alive: { value: boolean };
}

function makeTestLock(): TestLock {
  const dir = mkdtempSync(join(tmpdir(), "shcli-lock-"));
  const lockPath = join(dir, "lifecycle.lock");
  const clock = { t: Date.now() };
  const alive = { value: true };
  const deps: LockDeps = {
    now: () => clock.t,
    pidAlive: () => alive.value,
    lockPath: () => lockPath,
    staleAfterMs: STALE_AFTER_MS,
  };
  return { deps, lockPath, dir, clock, alive };
}

/** Write a lock file owned by a foreign pid; returns its real mtimeMs. */
function writeForeignLock(lockPath: string, content?: string): number {
  writeFileSync(
    lockPath,
    content ??
      JSON.stringify({ pid: FOREIGN_PID, startedAt: new Date().toISOString(), version: "test" }),
  );
  return statSync(lockPath).mtimeMs;
}

describe("lifecycle lock (unit, injected deps)", () => {
  let tl: TestLock;

  beforeEach(() => {
    tl = makeTestLock();
  });

  afterEach(() => {
    rmSync(tl.dir, { recursive: true, force: true });
  });

  test("acquire on empty dir succeeds and records this pid", () => {
    expect(tryAcquireLock(tl.deps)).toBe(true);
    expect(existsSync(tl.lockPath)).toBe(true);
    const info = JSON.parse(readFileSync(tl.lockPath, "utf8"));
    expect(info.pid).toBe(process.pid);
    expect(verifyLockOwnership(tl.deps)).toBe(true);
  });

  test("readLock returns null when no lock file exists", () => {
    expect(readLock(tl.deps)).toBeNull();
  });

  test("fresh foreign lock with live pid blocks acquisition", () => {
    const mtimeMs = writeForeignLock(tl.lockPath);
    tl.clock.t = mtimeMs + 1_000; // well within staleAfterMs
    tl.alive.value = true;

    expect(tryAcquireLock(tl.deps)).toBe(false);
    // The foreign lock must be left untouched
    expect(JSON.parse(readFileSync(tl.lockPath, "utf8")).pid).toBe(FOREIGN_PID);
  });

  test("stale by mtime: heartbeat stopped -> takeover even though pid is alive", () => {
    const mtimeMs = writeForeignLock(tl.lockPath);
    tl.alive.value = true; // pid lives, but...
    tl.clock.t = mtimeMs + tl.deps.staleAfterMs + 1; // ...heartbeat is too old

    expect(tryAcquireLock(tl.deps)).toBe(true);
    expect(JSON.parse(readFileSync(tl.lockPath, "utf8")).pid).toBe(process.pid);
  });

  test("stale by dead pid: fresh mtime but dead owner -> takeover", () => {
    const mtimeMs = writeForeignLock(tl.lockPath);
    tl.clock.t = mtimeMs + 1_000; // mtime is fresh
    tl.alive.value = false; // but the owner is dead

    expect(tryAcquireLock(tl.deps)).toBe(true);
    expect(JSON.parse(readFileSync(tl.lockPath, "utf8")).pid).toBe(process.pid);
  });

  test("corrupt lock content (not JSON) is treated as stale -> takeover", () => {
    const mtimeMs = writeForeignLock(tl.lockPath, "this is not json {");
    tl.clock.t = mtimeMs + 1_000;
    tl.alive.value = true;

    const read = readLock(tl.deps);
    expect(read).not.toBeNull();
    expect(read!.info).toBeNull(); // unparseable -> info null
    expect(isLockStale(read!, tl.deps)).toBe(true);

    expect(tryAcquireLock(tl.deps)).toBe(true);
    expect(JSON.parse(readFileSync(tl.lockPath, "utf8")).pid).toBe(process.pid);
  });

  test("valid JSON missing a numeric pid is treated as stale -> takeover", () => {
    const mtimeMs = writeForeignLock(tl.lockPath, JSON.stringify({ startedAt: "x", version: "y" }));
    tl.clock.t = mtimeMs + 1_000;
    tl.alive.value = true;

    expect(tryAcquireLock(tl.deps)).toBe(true);
    expect(JSON.parse(readFileSync(tl.lockPath, "utf8")).pid).toBe(process.pid);
  });

  test("idempotent re-acquire: lock already ours -> true", () => {
    expect(tryAcquireLock(tl.deps)).toBe(true);
    expect(tryAcquireLock(tl.deps)).toBe(true); // EEXIST path -> pid matches -> ours
    expect(JSON.parse(readFileSync(tl.lockPath, "utf8")).pid).toBe(process.pid);
  });

  test("heartbeatLock bumps mtime to the injected now", () => {
    expect(tryAcquireLock(tl.deps)).toBe(true);
    const before = statSync(tl.lockPath).mtimeMs;

    tl.clock.t = before + 45_000; // later heartbeat time
    heartbeatLock(tl.deps);

    const after = statSync(tl.lockPath).mtimeMs;
    expect(after).toBeGreaterThan(before);
    // utimesSync sets mtime to the injected clock (small FS-resolution slack)
    expect(Math.abs(after - tl.clock.t)).toBeLessThan(10);
  });

  test("heartbeat keeps a lock fresh past the original staleness horizon", () => {
    expect(tryAcquireLock(tl.deps)).toBe(true);
    tl.clock.t += tl.deps.staleAfterMs - 1_000;
    heartbeatLock(tl.deps);
    tl.clock.t += tl.deps.staleAfterMs - 1_000; // > staleAfterMs after CREATION, < after heartbeat
    expect(isLockStale(readLock(tl.deps)!, tl.deps)).toBe(false);
  });

  test("verifyOwnership false after foreign overwrite; releaseLock then does NOT unlink", () => {
    expect(tryAcquireLock(tl.deps)).toBe(true);

    writeForeignLock(tl.lockPath); // someone else took over
    expect(verifyLockOwnership(tl.deps)).toBe(false);

    releaseLock(tl.deps); // must refuse to delete a lock we don't own
    expect(existsSync(tl.lockPath)).toBe(true);
    expect(JSON.parse(readFileSync(tl.lockPath, "utf8")).pid).toBe(FOREIGN_PID);
  });

  test("releaseLock when owned removes the file", () => {
    expect(tryAcquireLock(tl.deps)).toBe(true);
    releaseLock(tl.deps);
    expect(existsSync(tl.lockPath)).toBe(false);
  });
});

describe("tryAcquireLock — verify-after-create (TOCTOU guard)", () => {
  // WHY THERE IS NO FULL INTERLEAVING TEST: the race this guard closes lives
  // INSIDE a single synchronous tryAcquireLock call — a rival candidate
  // holding the same stale snapshot unlinks OUR just-created lock between our
  // tryCreate and our return. lock.ts deliberately exposes no fs-level
  // injection seam (LockDeps injects clock/pid/path, not fs operations), so
  // the interleaving cannot be reproduced deterministically in-process.
  // Instead we pin BOTH halves of the fix's contract:
  //   1. the observable invariant — takeover success implies the on-disk lock
  //      names this process at return time (verify-after-create passed), and
  //   2. a source-level tripwire — the takeover path's return value IS the
  //      ownership verification, not the blind result of the create.
  // The multi-process contention suite below exercises the real create race.
  let tl: TestLock;

  beforeEach(() => {
    tl = makeTestLock();
  });

  afterEach(() => {
    rmSync(tl.dir, { recursive: true, force: true });
  });

  test("invariant: stale-takeover success implies verified on-disk ownership", () => {
    const mtimeMs = writeForeignLock(tl.lockPath);
    tl.clock.t = mtimeMs + 1_000;
    tl.alive.value = false; // dead owner -> stale -> takeover (unlink + create) path

    expect(tryAcquireLock(tl.deps)).toBe(true);
    // The fix guarantees: a true return means the file on disk names US.
    expect(verifyLockOwnership(tl.deps)).toBe(true);
    expect(JSON.parse(readFileSync(tl.lockPath, "utf8")).pid).toBe(process.pid);

    // And the moment a rival overwrites the file, ownership is gone — the
    // exact post-create check the takeover path performs before claiming
    // leadership.
    writeForeignLock(tl.lockPath);
    expect(verifyLockOwnership(tl.deps)).toBe(false);
  });

  test("source tripwire: takeover path returns verifyLockOwnership(deps), not a blind create result", () => {
    const src = readFileSync(join(import.meta.dir, "..", "lifecycle", "lock.ts"), "utf8");
    const fnStart = src.indexOf("export function tryAcquireLock");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = src.indexOf("export function", fnStart + 1);
    const body = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

    // The takeover path starts at the unlink of the stale lock.
    const unlinkIdx = body.indexOf("unlinkSync");
    expect(unlinkIdx).toBeGreaterThan(-1);
    const takeoverTail = body.slice(unlinkIdx);

    // Post-takeover-create, the function must claim leadership ONLY via the
    // ownership re-read. If this trips after an intentional refactor, make
    // sure the verify-after-create semantics survived, then update this test.
    expect(takeoverTail).toContain("return verifyLockOwnership(deps);");
    // The pre-fix shape — trusting the create alone — must not come back.
    expect(takeoverTail).not.toContain("return tryCreate");
    expect(takeoverTail).not.toContain("return true");
  });
});

describe("defaultLockDeps — SUPERHUMAN_LOCK_STALE_MS clamp", () => {
  const ORIG = process.env.SUPERHUMAN_LOCK_STALE_MS;

  afterEach(() => {
    if (ORIG === undefined) {
      delete process.env.SUPERHUMAN_LOCK_STALE_MS;
    } else {
      process.env.SUPERHUMAN_LOCK_STALE_MS = ORIG;
    }
  });

  test('negative override ("-5") is clamped to the 90s default', () => {
    process.env.SUPERHUMAN_LOCK_STALE_MS = "-5";
    expect(defaultLockDeps().staleAfterMs).toBe(STALE_AFTER_MS);
  });

  test('zero override ("0") is clamped to the 90s default (would cause leader churn)', () => {
    process.env.SUPERHUMAN_LOCK_STALE_MS = "0";
    expect(defaultLockDeps().staleAfterMs).toBe(STALE_AFTER_MS);
  });

  test('sub-floor override ("999") is clamped to the 90s default', () => {
    process.env.SUPERHUMAN_LOCK_STALE_MS = "999";
    expect(defaultLockDeps().staleAfterMs).toBe(STALE_AFTER_MS);
  });

  test('sane override ("5000") is honored', () => {
    process.env.SUPERHUMAN_LOCK_STALE_MS = "5000";
    expect(defaultLockDeps().staleAfterMs).toBe(5_000);
  });

  test("non-numeric override falls back to the default", () => {
    process.env.SUPERHUMAN_LOCK_STALE_MS = "ninety seconds";
    expect(defaultLockDeps().staleAfterMs).toBe(STALE_AFTER_MS);
  });
});

describe("lifecycle lock (multi-process contention)", () => {
  const FIXTURE = join(import.meta.dir, "fixtures", "acquire-lock.ts");
  const CANDIDATES = 5;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "shcli-lock-mp-"));
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test(
    "exactly one of 5 concurrent processes wins; dead-pid takeover afterwards",
    async () => {
      const procs = Array.from({ length: CANDIDATES }, () =>
        Bun.spawn(["bun", FIXTURE], {
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            SUPERHUMAN_CLI_CONFIG_DIR: dir,
            LOCK_FIXTURE_FOLLOWERS: String(CANDIDATES - 1),
          },
        }),
      );

      const outputs = await Promise.all(procs.map((p) => new Response(p.stdout).text()));
      const stderrs = await Promise.all(procs.map((p) => new Response(p.stderr).text()));
      await Promise.all(procs.map((p) => p.exited));

      const verdicts = outputs.map((o) => o.trim());
      const leaders = verdicts.filter((v) => v === "LEADER");
      const followers = verdicts.filter((v) => v === "FOLLOWER");
      if (leaders.length !== 1 || followers.length !== CANDIDATES - 1) {
        // Surface fixture output before the assertion fails, for debuggability
        console.error(`verdicts=${JSON.stringify(verdicts)} stderr=${JSON.stringify(stderrs)}`);
      }
      expect(leaders.length).toBe(1);
      expect(followers.length).toBe(CANDIDATES - 1);

      // The fixture leader exited WITHOUT releasing — the lock file survives
      // with a dead owner pid and a fresh mtime.
      const lockPath = join(dir, "lifecycle.lock");
      expect(existsSync(lockPath)).toBe(true);
      const ownerPid = JSON.parse(readFileSync(lockPath, "utf8")).pid as number;
      expect(ownerPid).not.toBe(process.pid);

      // Takeover after leader death: default (real) pidAlive sees the dead
      // fixture pid -> stale -> this test process acquires the lock.
      // (Tiny theoretical flake window: the OS could recycle the exact fixture
      // pid between exit and this check; in practice the window is ~ms.)
      const deps: LockDeps = { ...defaultLockDeps(), lockPath: () => lockPath };
      expect(tryAcquireLock(deps)).toBe(true);
      expect(verifyLockOwnership(deps)).toBe(true);
      expect(JSON.parse(readFileSync(lockPath, "utf8")).pid).toBe(process.pid);
    },
    30_000, // 5 bun subprocesses on Windows are slow to start
  );
});
