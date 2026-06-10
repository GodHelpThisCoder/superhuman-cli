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
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync, readFileSync } from "node:fs";
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

/**
 * Drive a fresh leader to gave_up: launch always fails; advance the clock past
 * each backoff step until MAX_RELAUNCH_FAILURES is hit.
 */
async function driveToGaveUp(h: Harness): Promise<void> {
  h.setLaunch(async () => false);

  await h.mgr.tickOnce(); // become leader, classify down, launch #1 fails
  for (let i = 0; i < MAX_RELAUNCH_FAILURES - 1; i++) {
    h.clock.t += BACKOFF_SCHEDULE_MS[i]! + 1_000;
    await h.mgr.tickOnce(); // launch #(i+2) fails
  }

  expect(h.launchCalls.length).toBe(MAX_RELAUNCH_FAILURES);
  expect(h.mgr.getStatus().state).toBe("gave_up");
}

describe("LifecycleManager — launch-in-flight classification guard", () => {
  test("processProbe TRUE during our own launch never misclassifies as down_no_debug_port", async () => {
    const h = makeManager({ readyWaitMs: 50 });
    h.flags.cdp = false;
    h.flags.proc = false; // nothing running yet — classification allows a launch
    let resolveLaunch: ((ok: boolean) => void) | undefined;
    h.setLaunch(() => new Promise<boolean>((r) => { resolveLaunch = r; }));

    // KEEP-ALIVE QUIRK: ensureReady's readyWait timer is unref()ed (see the
    // "launch hangs" test above) — a ref'ed interval keeps Bun's test event
    // loop live while the only pending work is that timer + our held launch.
    const keepAlive = setInterval(() => {}, 10);
    try {
      // Start the launch via ensureReady (a tick would AWAIT the held launch
      // and block). It times out after readyWaitMs, leaving the launch in
      // flight — exactly the window the guard protects.
      const first = await h.mgr.ensureReady();
      expect(first.ok).toBe(false);
      expect(first.reason).toContain("still starting");
      expect(h.launchCalls.length).toBe(1);
      expect(h.mgr.getStatus().isLeader).toBe(true);

      // The spawned process appears in the process table BEFORE CDP opens.
      h.flags.proc = true;

      // (a) Health tick: must report "down (launch in progress)" — NOT
      // down_no_debug_port, whose message tells the user to restart the very
      // app we are in the middle of starting.
      await h.mgr.tickOnce();
      const status = h.mgr.getStatus();
      expect(status.state).toBe("down");
      expect(status.state).not.toBe("down_no_debug_port");
      expect(status.detail).toBe("launch in progress");

      // (b) ensureReady joins the in-flight launch (no classification, no
      // second launch) and returns the "still starting" reason — never the
      // no-debug-port advice.
      const second = await h.mgr.ensureReady();
      expect(second.ok).toBe(false);
      expect(second.reason).toContain("still starting");
      expect(second.reason).not.toContain("--remote-debugging-port");
      expect(h.launchCalls.length).toBe(1); // coalesced — no second spawn

      // Launch completes and CDP comes up — full recovery.
      h.flags.cdp = true;
      resolveLaunch!(true);
      await Bun.sleep(10); // let the launch continuation clear launchInFlight
      h.flags.proc = false;
      await h.mgr.tickOnce();
      expect(h.mgr.getStatus().state).toBe("ready");
      expect((await h.mgr.ensureReady()).ok).toBe(true);
      expect(h.launchCalls.length).toBe(1);
    } finally {
      clearInterval(keepAlive);
    }
  });
});

describe("LifecycleManager — gave_up does not survive re-election", () => {
  test("demotion then takeover resets the failure counter and re-enables launching", async () => {
    // pidAlive is mutable per-pid: the foreign leader is alive during the
    // demotion phase, then dies so its lock goes stale.
    const foreignAlive = { value: true };
    const h = makeManager({
      pidAlive: (pid) => (pid === FOREIGN_PID ? foreignAlive.value : true),
    });

    await driveToGaveUp(h);

    // Another instance takes over the lock (e.g. after sleep/resume) — demote.
    writeForeignLock(h.lockPath);
    await h.mgr.tickOnce(); // leaderTick -> verifyLockOwnership false -> demote
    expect(h.mgr.getStatus().isLeader).toBe(false);
    expect(h.launchCalls.length).toBe(MAX_RELAUNCH_FAILURES); // followers never launch

    // The foreign leader dies -> its lock is stale (dead pid) -> takeover.
    foreignAlive.value = false;
    await h.mgr.tickOnce(); // followerTick -> tryAcquireLock -> becomeLeader -> leaderTick

    const status = h.mgr.getStatus();
    expect(status.isLeader).toBe(true);
    // becomeLeader() must reset the terminal state: a re-elected leader stuck
    // in gave_up would never launch again.
    expect(status.state).not.toBe("gave_up");
    // The failure counter was reset, so the SAME re-election tick already
    // attempted a fresh launch (which failed -> "down" with fresh backoff).
    expect(h.launchCalls.length).toBe(MAX_RELAUNCH_FAILURES + 1);
    expect(status.state).toBe("down");

    // And launching keeps working on subsequent down-state ticks.
    h.clock.t += BACKOFF_SCHEDULE_MS[0]! + 1_000;
    await h.mgr.tickOnce();
    expect(h.launchCalls.length).toBe(MAX_RELAUNCH_FAILURES + 2);
  });
});

describe("LifecycleManager — gave_up keyed on the failure counter, not the state label", () => {
  test("a down_no_debug_port excursion does not re-enable launching", async () => {
    const h = makeManager();
    await driveToGaveUp(h);

    // Excursion: the user starts Superhuman WITHOUT the debug port. The state
    // label leaves "gave_up"...
    h.flags.proc = true;
    await h.mgr.tickOnce();
    expect(h.mgr.getStatus().state).toBe("down_no_debug_port");
    expect(h.launchCalls.length).toBe(MAX_RELAUNCH_FAILURES);

    // ...then the app closes again. If give-up were keyed on the state label,
    // the excursion would have erased it and (with every backoff window long
    // expired) this tick would launch. The counter (still >= max) must keep
    // launching disabled.
    h.flags.proc = false;
    h.clock.t += 100 * BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1]!;
    await h.mgr.tickOnce();
    expect(h.launchCalls.length).toBe(MAX_RELAUNCH_FAILURES); // NO new launch
    expect(h.mgr.getStatus().state).toBe("gave_up"); // re-enters gave_up

    // ensureReady is equally passive.
    const result = await h.mgr.ensureReady();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("paused");
    expect(h.launchCalls.length).toBe(MAX_RELAUNCH_FAILURES);
  });
});

describe("LifecycleManager — heartbeatIfLeader", () => {
  test("leader with a fresh owned lock: heartbeat bumps mtime to the injected clock", async () => {
    const h = makeManager();
    h.flags.cdp = true;
    await h.mgr.tickOnce(); // become leader + ready (leaderTick heartbeats to clock.t)
    expect(h.mgr.getStatus().isLeader).toBe(true);

    const before = statSync(h.lockPath).mtimeMs;
    h.clock.t += 45_000;
    h.mgr.heartbeatIfLeader();

    const after = statSync(h.lockPath).mtimeMs;
    expect(after).toBeGreaterThan(before);
    // utimesSync sets mtime to the injected lockDeps.now (FS-resolution slack)
    expect(Math.abs(after - h.clock.t)).toBeLessThan(10);
    expect(h.mgr.getStatus().isLeader).toBe(true); // still leader
  });

  test("lock stolen by a foreign pid: heartbeat demotes and does NOT touch the file", async () => {
    const h = makeManager();
    h.flags.cdp = true;
    await h.mgr.tickOnce();
    expect(h.mgr.getStatus().isLeader).toBe(true);

    writeForeignLock(h.lockPath); // rival took over
    const stolenMtime = statSync(h.lockPath).mtimeMs;
    h.clock.t += 45_000;
    h.mgr.heartbeatIfLeader();

    expect(h.mgr.getStatus().isLeader).toBe(false); // demoted
    // Freshening a rival's lock would extend its lease after a takeover —
    // the heartbeat must verify ownership FIRST and leave the file alone.
    expect(statSync(h.lockPath).mtimeMs).toBe(stolenMtime);
    expect(JSON.parse(readFileSync(h.lockPath, "utf8")).pid).toBe(FOREIGN_PID);
  });
});
