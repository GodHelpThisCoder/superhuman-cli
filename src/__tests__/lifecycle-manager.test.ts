/**
 * Unit tests for LifecycleManager (src/lifecycle/manager.ts) — fully injected:
 * fake clock, fake probes, recorded launch mock, temp-dir lock.
 *
 * IMPORTANT — how leadership is driven without start():
 * start() uses real setInterval timers, so unit tests never call it. Instead
 * they rely on the manager's lazy acquisition paths: a fresh manager has
 * leader=false, and tickOnce() routes through followerTick(), whose FIRST
 * action is tryAcquireLock(). With no lock file present the manager acquires
 * the lock, becomeLeader()s, and runs leaderTick() within that same tick.
 * ensureReady() has the equivalent takeover attempt. So "make this manager
 * the leader" == "ensure no (live) lock file exists, then tickOnce()".
 */

import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LifecycleManager,
  BACKOFF_SCHEDULE_MS,
  MAX_RELAUNCH_FAILURES,
} from "../lifecycle/manager";
import { STALE_AFTER_MS, type LockDeps } from "../lifecycle/lock";

const PORT = 39_333; // never 9333 (the real Superhuman CDP port)
const FOREIGN_PID = 999_999;
const BASE_T = 1_750_000_000_000; // arbitrary realistic epoch base for the fake clock

interface Harness {
  mgr: LifecycleManager;
  /** Fake clock shared by the manager and its lockDeps. Advance via clock.t += ms. */
  clock: { t: number };
  flags: { cdp: boolean; proc: boolean; updater: boolean };
  launchCalls: number[]; // fake-clock timestamps of each launch() call
  setLaunch(impl: () => Promise<boolean>): void;
  lockPath: string;
  dir: string;
}

const tempDirs: string[] = [];

function makeManager(overrides?: {
  pidAlive?: (pid: number) => boolean;
  readyWaitMs?: number;
}): Harness {
  const dir = mkdtempSync(join(tmpdir(), "shcli-mgr-"));
  tempDirs.push(dir);
  const lockPath = join(dir, "lifecycle.lock");
  const clock = { t: BASE_T };
  const flags = { cdp: false, proc: false, updater: false };
  const launchCalls: number[] = [];
  let launchImpl: () => Promise<boolean> = async () => false;

  const lockDeps: LockDeps = {
    now: () => clock.t,
    pidAlive: overrides?.pidAlive ?? (() => true),
    lockPath: () => lockPath,
    staleAfterMs: STALE_AFTER_MS,
  };

  const mgr = new LifecycleManager(PORT, {
    cdpProbe: async () => flags.cdp,
    processProbe: async () => flags.proc,
    updaterProbe: async () => flags.updater,
    launch: () => {
      launchCalls.push(clock.t);
      return launchImpl();
    },
    now: () => clock.t,
    lockDeps,
    readyWaitMs: overrides?.readyWaitMs ?? 50,
  });

  return {
    mgr,
    clock,
    flags,
    launchCalls,
    setLaunch: (impl) => {
      launchImpl = impl;
    },
    lockPath,
    dir,
  };
}

function writeForeignLock(lockPath: string): void {
  writeFileSync(
    lockPath,
    JSON.stringify({ pid: FOREIGN_PID, startedAt: new Date().toISOString(), version: "test" }),
  );
}

afterEach(() => {
  // Managers are never start()ed, so there are no timers to stop — just dirs.
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("LifecycleManager — leadership", () => {
  test("no existing lock: first tick acquires leadership", async () => {
    const h = makeManager();
    expect(h.mgr.getStatus().isLeader).toBe(false); // fresh manager is a follower

    await h.mgr.tickOnce(); // followerTick -> tryAcquireLock -> becomeLeader -> leaderTick

    expect(h.mgr.getStatus().isLeader).toBe(true);
    expect(h.mgr.getStatus().leaderPid).toBe(process.pid);
    expect(existsSync(h.lockPath)).toBe(true);
  });

  test("leader + CDP reachable: state ready, zero launches", async () => {
    const h = makeManager();
    h.flags.cdp = true;

    await h.mgr.tickOnce();

    const status = h.mgr.getStatus();
    expect(status.isLeader).toBe(true);
    expect(status.state).toBe("ready");
    expect(h.launchCalls.length).toBe(0);
  });

  test("follower with live foreign lock + CDP down: follower_down, never launches", async () => {
    const h = makeManager(); // injected pidAlive: () => true keeps the foreign lock live
    writeForeignLock(h.lockPath);
    h.flags.cdp = false;

    await h.mgr.tickOnce();

    const status = h.mgr.getStatus();
    expect(status.isLeader).toBe(false);
    expect(status.state).toBe("follower_down");
    expect(status.leaderPid).toBe(FOREIGN_PID);
    expect(h.launchCalls.length).toBe(0);

    const result = await h.mgr.ensureReady();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Another session");
    expect(result.reason).toContain(String(FOREIGN_PID));
    expect(h.launchCalls.length).toBe(0); // followers NEVER launch
  });

  test("follower with live foreign lock + CDP up: state ready (someone else's leader is fine)", async () => {
    const h = makeManager();
    writeForeignLock(h.lockPath);
    h.flags.cdp = true;

    await h.mgr.tickOnce();

    expect(h.mgr.getStatus().isLeader).toBe(false);
    expect(h.mgr.getStatus().state).toBe("ready");
    expect(h.launchCalls.length).toBe(0);
  });

  test("demotion: leader loses the lock file to a foreign pid", async () => {
    const h = makeManager();
    h.flags.cdp = true;
    await h.mgr.tickOnce();
    expect(h.mgr.getStatus().isLeader).toBe(true);

    writeForeignLock(h.lockPath); // another instance took over (e.g. after sleep/resume)
    await h.mgr.tickOnce(); // leaderTick -> verifyLockOwnership false -> demote

    expect(h.mgr.getStatus().isLeader).toBe(false);
    expect(h.launchCalls.length).toBe(0);
  });

  test("takeover in ensureReady: foreign DEAD lock, launch succeeds -> leader + ready", async () => {
    const h = makeManager({ pidAlive: () => false }); // foreign owner is dead -> lock stale
    writeForeignLock(h.lockPath);
    h.flags.cdp = false;
    h.setLaunch(async () => {
      h.flags.cdp = true; // app comes up as part of the launch
      return true;
    });

    const result = await h.mgr.ensureReady();

    expect(result.ok).toBe(true);
    expect(h.mgr.getStatus().isLeader).toBe(true);
    expect(h.mgr.getStatus().state).toBe("ready");
    expect(h.launchCalls.length).toBe(1);
  });
});

describe("LifecycleManager — leader never launches against updater / portless app", () => {
  test("updater active: state updating, zero launches", async () => {
    const h = makeManager();
    h.flags.cdp = false;
    h.flags.updater = true;

    await h.mgr.tickOnce(); // acquires leadership, then classifies

    expect(h.mgr.getStatus().isLeader).toBe(true);
    expect(h.mgr.getStatus().state).toBe("updating");
    expect(h.launchCalls.length).toBe(0);

    const result = await h.mgr.ensureReady();
    expect(result.ok).toBe(false);
    expect(result.reason.toLowerCase()).toContain("update");
    expect(h.launchCalls.length).toBe(0);
  });

  test("app running without debug port: down_no_debug_port, zero launches", async () => {
    const h = makeManager();
    h.flags.cdp = false;
    h.flags.proc = true; // process present + CDP down = no debug port

    await h.mgr.tickOnce();

    expect(h.mgr.getStatus().state).toBe("down_no_debug_port");
    expect(h.launchCalls.length).toBe(0);

    const result = await h.mgr.ensureReady();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("--remote-debugging-port");
    expect(h.launchCalls.length).toBe(0);
  });
});

describe("LifecycleManager — relaunch backoff and give-up", () => {
  test("backoff schedule, gave_up after MAX failures, passive recovery resets counter", async () => {
    const h = makeManager();
    // all probes false, launch always fails
    h.setLaunch(async () => false);

    // Tick 1: become leader, classify down, attempt launch #1 (fails)
    await h.mgr.tickOnce();
    expect(h.launchCalls.length).toBe(1);
    expect(h.mgr.getStatus().state).toBe("down");

    // Immediate second tick: backoff window (60s) is open -> NO new launch
    await h.mgr.tickOnce();
    expect(h.launchCalls.length).toBe(1);

    // Advance past backoff step 1 (60s) -> launch #2
    h.clock.t += BACKOFF_SCHEDULE_MS[0]! + 1_000; // 61s
    await h.mgr.tickOnce();
    expect(h.launchCalls.length).toBe(2);

    // Advance past backoff step 2 (120s) -> launch #3
    h.clock.t += BACKOFF_SCHEDULE_MS[1]! + 1_000;
    await h.mgr.tickOnce();
    expect(h.launchCalls.length).toBe(3);

    // Advance past backoff step 3 (240s) -> launch #4 -> MAX_RELAUNCH_FAILURES -> gave_up
    h.clock.t += BACKOFF_SCHEDULE_MS[2]! + 1_000;
    await h.mgr.tickOnce();
    expect(h.launchCalls.length).toBe(MAX_RELAUNCH_FAILURES);
    expect(h.mgr.getStatus().state).toBe("gave_up");

    // Far future: still gave up — passive probing only, NEVER spawns again
    h.clock.t += 100 * BACKOFF_SCHEDULE_MS[3]!;
    await h.mgr.tickOnce();
    expect(h.launchCalls.length).toBe(MAX_RELAUNCH_FAILURES);
    expect(h.mgr.getStatus().state).toBe("gave_up");

    // ensureReady in gave_up is also passive
    const result = await h.mgr.ensureReady();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("paused");
    expect(h.launchCalls.length).toBe(MAX_RELAUNCH_FAILURES);

    // Passive recovery: the user launched Superhuman manually
    h.flags.cdp = true;
    await h.mgr.tickOnce();
    expect(h.mgr.getStatus().state).toBe("ready");

    // The failure counter was reset on recovery: when the app goes down again
    // a launch fires immediately (no leftover backoff / give-up latch).
    h.flags.cdp = false;
    await h.mgr.tickOnce();
    expect(h.launchCalls.length).toBe(MAX_RELAUNCH_FAILURES + 1);
    expect(h.mgr.getStatus().state).toBe("down");
  });
});

describe("LifecycleManager — ensureReady (tool-call gate)", () => {
  test("already ready: ok true, zero launches", async () => {
    const h = makeManager();
    h.flags.cdp = true;
    const result = await h.mgr.ensureReady();
    expect(result.ok).toBe(true);
    expect(h.launchCalls.length).toBe(0);
  });

  test("leader-down happy path: launch succeeds -> ok true", async () => {
    const h = makeManager();
    h.flags.cdp = false;
    h.setLaunch(async () => {
      h.flags.cdp = true;
      return true;
    });

    const result = await h.mgr.ensureReady();

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("");
    expect(h.mgr.getStatus().state).toBe("ready");
    expect(h.launchCalls.length).toBe(1);
  });

  test("launch hangs: resolves ok:false with 'still starting' after readyWaitMs", async () => {
    const h = makeManager({ readyWaitMs: 50 });
    h.flags.cdp = false;
    h.setLaunch(() => new Promise<boolean>(() => {})); // never resolves

    // KEEP-ALIVE QUIRK: ensureReady's readyWait timer is unref()ed in
    // production (so it can never keep a dead server process alive). Under
    // `bun test`, when the ONLY pending work is this unref'ed timer plus a
    // never-resolving launch promise, Bun's event loop goes dormant and the
    // timer never fires — the await hangs forever (observed on Bun 1.3.12,
    // Windows). In the real server process stdin/transport activity always
    // keeps the loop live. A ref'ed interval reproduces that here.
    const keepAlive = setInterval(() => {}, 10);
    try {
      const started = Date.now();
      const result = await h.mgr.ensureReady();
      const elapsed = Date.now() - started;

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("still starting");
      expect(h.launchCalls.length).toBe(1);
      // Must return after ~readyWaitMs (50ms), not block on the hung launch.
      // Generous ceiling for Windows timer slop.
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      clearInterval(keepAlive);
    }
  });

  test("requestLaunch (LaunchBroker) delegates to ensureReady", async () => {
    const h = makeManager();
    h.flags.cdp = false;
    h.setLaunch(async () => {
      h.flags.cdp = true;
      return true;
    });

    expect(await h.mgr.requestLaunch(PORT)).toBe(true);
    expect(h.launchCalls.length).toBe(1);
  });
});
