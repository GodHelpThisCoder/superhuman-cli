/**
 * LifecycleManager — leader-elected Superhuman app lifecycle management.
 *
 * Exactly one MCP server instance (the lockfile leader) owns launching and
 * health-monitoring the Superhuman app. Followers never launch or kill the
 * app; they fail tool calls fast with status-rich, retryable errors and
 * periodically attempt takeover in case the leader died.
 *
 * Design invariants:
 * - The MCP stdio handshake NEVER waits on Superhuman (manager starts after
 *   the transport connects, and start() is non-blocking).
 * - The manager never kills a Superhuman process (see connection.ts never-kill).
 * - No launch attempts while the update installer is active, or while
 *   Superhuman is running without the debug port (Electron's single-instance
 *   lock makes such spawns exit silently — the old infinite-relaunch loop).
 * - Repeated launch failures back off exponentially and eventually give up,
 *   recovering passively if Superhuman appears (e.g. user launched it).
 */

import { createLogger } from "../logger";
import { isSuperhumanRunning, launchSuperhuman } from "../cdp/connection";
import { isUpdaterRunning } from "../update-awareness";
import { isSuperhumanProcessRunning } from "./process-detect";
import {
  tryAcquireLock,
  heartbeatLock,
  releaseLock,
  verifyLockOwnership,
  readLock,
  defaultLockDeps,
  type LockDeps,
} from "./lock";

const log = createLogger("lifecycle");

export type LifecycleState =
  | "starting" // before the first tick completes
  | "ready" // CDP reachable
  | "updating" // update installer active — never launch
  | "down" // app not running; leader relaunches with backoff
  | "down_no_debug_port" // app running WITHOUT the debug port — never launch
  | "gave_up" // too many launch failures; passive probing only
  | "follower_down"; // not the leader, and CDP is unreachable

export interface LifecycleStatus {
  state: LifecycleState;
  isLeader: boolean;
  leaderPid: number | null;
  detail: string;
  sinceMs: number;
}

export interface ReadyResult {
  ok: boolean;
  reason: string;
}

export interface ManagerDeps {
  cdpProbe(): Promise<boolean>;
  processProbe(): Promise<boolean>;
  updaterProbe(): Promise<boolean>;
  launch(): Promise<boolean>;
  now(): number;
  lockDeps: LockDeps;
  /** Max ms a tool call waits on a leader-side launch (test seam). */
  readyWaitMs: number;
}

export const HEALTH_TICK_MS = 30_000;
/** Heartbeat cadence — independent of health ticks so a long launch can't starve it. */
export const HEARTBEAT_MS = 30_000;
export const BACKOFF_SCHEDULE_MS = [60_000, 120_000, 240_000, 480_000];
export const MAX_RELAUNCH_FAILURES = 4;
/** Max time a tool call waits on a leader-side launch before returning a retryable error. */
export const ENSURE_READY_WAIT_MS = 30_000;

function defaultDeps(port: number): ManagerDeps {
  return {
    cdpProbe: () => isSuperhumanRunning(port),
    processProbe: () => isSuperhumanProcessRunning(),
    updaterProbe: () => isUpdaterRunning(),
    launch: () => launchSuperhuman(port),
    now: Date.now,
    lockDeps: defaultLockDeps(),
    readyWaitMs: ENSURE_READY_WAIT_MS,
  };
}

export class LifecycleManager {
  private readonly deps: ManagerDeps;
  private readonly port: number;

  private state: LifecycleState = "starting";
  private stateSince: number;
  private detail = "";
  private leader = false;
  private failures = 0;
  private nextAttemptAt = 0;
  private launchInFlight: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private tickInFlight = false;
  private loggedNoDebugPort = false;
  private loggedGaveUp = false;

  constructor(port: number, deps?: Partial<ManagerDeps>) {
    this.port = port;
    this.deps = { ...defaultDeps(port), ...deps };
    this.stateSince = this.deps.now();
  }

  /**
   * Non-blocking start: attempt leadership, kick a background warm-up tick,
   * and schedule the recurring health tick. Never awaited by startup.
   */
  start(): void {
    if (this.timer) return;
    this.leader = tryAcquireLock(this.deps.lockDeps);
    log.info(
      this.leader
        ? `Lifecycle leader (pid ${process.pid}) — owns Superhuman launch/health duty`
        : `Lifecycle follower (pid ${process.pid}) — leader is pid ${this.leaderPid() ?? "unknown"}`,
    );
    void this.tick();
    this.timer = setInterval(() => void this.tick(), HEALTH_TICK_MS);
    // Heartbeat on its OWN timer: leaderTick awaits runLaunch() (up to 120s
    // during app updates) while holding tickInFlight, so tick-driven
    // heartbeats starve past the 90s staleness window and followers would
    // depose a live, mid-launch leader. A dedicated timer keeps the lock
    // fresh regardless of what the tick is doing.
    this.heartbeatTimer = setInterval(() => this.heartbeatIfLeader(), HEARTBEAT_MS);
    // Don't let the timers keep a dead server's event loop alive
    (this.timer as unknown as { unref?: () => void }).unref?.();
    (this.heartbeatTimer as unknown as { unref?: () => void }).unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.leader) {
      releaseLock(this.deps.lockDeps);
      this.leader = false;
    }
  }

  /**
   * Ownership-checked heartbeat (public for tests/diagnostics). Touching the
   * lock without verifying ownership would freshen a rival's lock after a
   * takeover, so verify first and demote on mismatch.
   */
  heartbeatIfLeader(): void {
    if (!this.leader || this.stopped) return;
    if (verifyLockOwnership(this.deps.lockDeps)) {
      heartbeatLock(this.deps.lockDeps);
    } else {
      log.warn("Lost lifecycle lock (heartbeat check) — demoting to follower");
      this.leader = false;
    }
  }

  getStatus(): LifecycleStatus {
    return {
      state: this.state,
      isLeader: this.leader,
      leaderPid: this.leaderPid(),
      detail: this.detail,
      sinceMs: this.stateSince,
    };
  }

  /** Human/agent-facing description of why Superhuman is unavailable. */
  describeUnavailable(): string {
    switch (this.state) {
      case "down_no_debug_port":
        return (
          `Superhuman is running but WITHOUT --remote-debugging-port=${this.port}, so it cannot be controlled. ` +
          `Run 'superhuman doctor --fix-port' to restart it with the debug port.`
        );
      case "updating":
        return "Superhuman update is installing. Retry in about a minute.";
      case "gave_up":
        return (
          `Superhuman failed to launch ${MAX_RELAUNCH_FAILURES} times in a row; automatic relaunching is paused. ` +
          `Launch Superhuman manually (or run 'superhuman doctor') — the server reconnects automatically once it's up.`
        );
      case "follower_down":
        return (
          `Superhuman is down. Another session (pid ${this.leaderPid() ?? "unknown"}) owns relaunch duty — ` +
          `retry in ~30 seconds.`
        );
      case "down": {
        const waitMs = Math.max(0, this.nextAttemptAt - this.deps.now());
        return waitMs > 0
          ? `Superhuman is down; relaunch is backing off (next attempt in ~${Math.ceil(waitMs / 1000)}s). Retry shortly.`
          : "Superhuman is down; relaunch in progress. Retry in ~30 seconds.";
      }
      case "starting":
        return "Superhuman lifecycle is still initializing. Retry in a few seconds.";
      default:
        return `Superhuman is unavailable (state: ${this.state}). Retry shortly.`;
    }
  }

  /**
   * Connection gate for tool calls. Leader: trigger/coalesce a launch and wait
   * up to ENSURE_READY_WAIT_MS. Follower: single probe + takeover attempt,
   * then a fast retryable error (the leader's next tick is ≤30s away).
   */
  async ensureReady(): Promise<ReadyResult> {
    if (await this.deps.cdpProbe()) {
      this.markReady();
      return { ok: true, reason: "" };
    }

    if (!this.leader) {
      // The leader may have died — cheap takeover attempt before giving up
      if (tryAcquireLock(this.deps.lockDeps)) {
        this.becomeLeader();
      } else {
        this.setState("follower_down");
        return { ok: false, reason: this.describeUnavailable() };
      }
    }

    // Leader path. If a launch WE started is already in flight, skip
    // classification entirely and join it — the spawned process exists in
    // tasklist before CDP comes up, so probing now would misdiagnose our own
    // launch as down_no_debug_port (and advise the user to close the app
    // we're starting).
    if (!this.launchInFlight) {
      // Classify before launching (never fight the updater or a
      // debug-port-less instance)
      if (await this.deps.updaterProbe()) {
        this.setState("updating");
        return { ok: false, reason: this.describeUnavailable() };
      }
      if (await this.deps.processProbe()) {
        this.setState("down_no_debug_port");
        this.logNoDebugPortOnce();
        return { ok: false, reason: this.describeUnavailable() };
      }

      // Give-up is keyed on the FAILURE COUNTER, not the state label — state
      // excursions (updating, no-debug-port) must not erase it, and a fresh
      // leadership term resets the counter in becomeLeader().
      if (this.failures >= MAX_RELAUNCH_FAILURES) {
        this.setState("gave_up", `${this.failures} consecutive launch failures`);
        return { ok: false, reason: this.describeUnavailable() };
      }
      this.setState("down");
      if (this.deps.now() < this.nextAttemptAt) {
        return { ok: false, reason: this.describeUnavailable() };
      }
    }

    // Launch (coalesced), but never block a tool call longer than the wait cap —
    // the launch continues in the background and a retry can find it ready.
    const launchPromise = this.runLaunch();
    const timedOut = Symbol("timeout");
    const result = await Promise.race([
      launchPromise,
      new Promise<typeof timedOut>((r) => {
        const t = setTimeout(() => r(timedOut), this.deps.readyWaitMs);
        (t as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
    if (result === timedOut) {
      return {
        ok: false,
        reason: "Superhuman is still starting (launch in progress). Retry in ~30 seconds.",
      };
    }
    if (result === true && (await this.deps.cdpProbe())) {
      this.markReady();
      return { ok: true, reason: "" };
    }
    return { ok: false, reason: this.describeUnavailable() };
  }

  /** LaunchBroker implementation — gates auto-launch requests from connection.ts. */
  async requestLaunch(_port: number): Promise<boolean> {
    const result = await this.ensureReady();
    return result.ok;
  }

  /** Run a single health tick on demand (used by tests and diagnostics). */
  async tickOnce(): Promise<void> {
    await this.tick();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async tick(): Promise<void> {
    if (this.stopped || this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      if (!this.leader) {
        await this.followerTick();
      } else {
        await this.leaderTick();
      }
    } catch (e) {
      log.error("Lifecycle tick error:", e instanceof Error ? e.message : String(e));
    } finally {
      this.tickInFlight = false;
    }
  }

  private async followerTick(): Promise<void> {
    if (tryAcquireLock(this.deps.lockDeps)) {
      this.becomeLeader();
      await this.leaderTick();
      return;
    }
    this.setState((await this.deps.cdpProbe()) ? "ready" : "follower_down");
  }

  private async leaderTick(): Promise<void> {
    if (!verifyLockOwnership(this.deps.lockDeps)) {
      // Another instance took over a stale lock (e.g. after sleep/resume) — demote
      log.warn(`Lost lifecycle lock to pid ${this.leaderPid() ?? "unknown"} — demoting to follower`);
      this.leader = false;
      return;
    }
    heartbeatLock(this.deps.lockDeps);

    if (await this.deps.cdpProbe()) {
      this.markReady();
      return;
    }

    // A launch we started is still in progress — the spawned process shows in
    // tasklist before CDP opens. Don't misclassify it as down_no_debug_port
    // and don't start a second launch; let it finish.
    if (this.launchInFlight) {
      this.setState("down", "launch in progress");
      return;
    }

    if (await this.deps.updaterProbe()) {
      this.setState("updating", "update installer active");
      return;
    }

    if (await this.deps.processProbe()) {
      this.setState("down_no_debug_port");
      this.logNoDebugPortOnce();
      return;
    }

    // Give-up is keyed on the failure counter (not the state label, which
    // updating/no-debug-port excursions overwrite). Passive probing only —
    // the cdpProbe above is the recovery path.
    if (this.failures >= MAX_RELAUNCH_FAILURES) {
      this.setState("gave_up", `${this.failures} consecutive launch failures`);
      return;
    }

    this.setState("down");
    if (this.deps.now() < this.nextAttemptAt) return;

    log.warn(`Superhuman not detected, attempting relaunch (failure count: ${this.failures})...`);
    const ok = await this.runLaunch();
    if (ok) {
      log.info("Superhuman relaunched successfully");
      this.markReady();
    }
    // Failure accounting happens in runLaunch so ensureReady shares it
  }

  /** Single ready-transition bookkeeping path — every recovery resets ALL of it. */
  private markReady(): void {
    this.setState("ready");
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.loggedNoDebugPort = false;
    this.loggedGaveUp = false;
  }

  private runLaunch(): Promise<boolean> {
    if (this.launchInFlight) return this.launchInFlight;
    this.launchInFlight = this.deps
      .launch()
      .then((ok) => {
        if (!ok) this.recordLaunchFailure();
        return ok;
      })
      .catch((e) => {
        log.error("Launch error:", e instanceof Error ? e.message : String(e));
        this.recordLaunchFailure();
        return false;
      })
      .finally(() => {
        this.launchInFlight = null;
      });
    return this.launchInFlight;
  }

  private recordLaunchFailure(): void {
    this.failures += 1;
    const backoff = BACKOFF_SCHEDULE_MS[Math.min(this.failures - 1, BACKOFF_SCHEDULE_MS.length - 1)]!;
    this.nextAttemptAt = this.deps.now() + backoff;
    if (this.failures >= MAX_RELAUNCH_FAILURES) {
      this.setState("gave_up", `${this.failures} consecutive launch failures`);
      if (!this.loggedGaveUp) {
        this.loggedGaveUp = true;
        log.error(
          `Giving up on automatic relaunch after ${this.failures} failures. ` +
            `Will reconnect automatically if Superhuman is started manually.`,
        );
      }
    } else {
      log.warn(`Launch failed (${this.failures}/${MAX_RELAUNCH_FAILURES}); next attempt in ${Math.round(backoff / 1000)}s`);
    }
  }

  private becomeLeader(): void {
    this.leader = true;
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.loggedGaveUp = false;
    // A fresh leadership term must never inherit the prior term's terminal
    // state (a re-elected leader stuck in "gave_up" would never launch again).
    this.setState("starting", "new leadership term");
    log.info(`Took over lifecycle leadership (pid ${process.pid})`);
  }

  private setState(state: LifecycleState, detail = ""): void {
    if (this.state !== state) {
      log.info(`Lifecycle state: ${this.state} -> ${state}${detail ? ` (${detail})` : ""}`);
      // Re-entering gave_up after an excursion should log at full severity again
      if (this.state === "gave_up") this.loggedGaveUp = false;
      this.state = state;
      this.stateSince = this.deps.now();
      if (state !== "down_no_debug_port") this.loggedNoDebugPort = false;
    }
    this.detail = detail || this.detail;
  }

  private logNoDebugPortOnce(): void {
    if (this.loggedNoDebugPort) return;
    this.loggedNoDebugPort = true;
    log.warn(
      `Superhuman is running WITHOUT --remote-debugging-port=${this.port}. ` +
        `Not launching a second instance (Electron's single-instance lock would discard it). ` +
        `Run 'superhuman doctor --fix-port' to restart it with the debug port.`,
    );
  }

  private leaderPid(): number | null {
    return readLock(this.deps.lockDeps)?.info?.pid ?? null;
  }
}

// ---------------------------------------------------------------------------
// Singleton registry — set by the MCP entry point, read by tool helpers.
// Absent in CLI mode (CLI invocations launch directly; they are explicit
// user actions).
// ---------------------------------------------------------------------------

let _manager: LifecycleManager | null = null;

export function setLifecycleManager(manager: LifecycleManager | null): void {
  _manager = manager;
}

export function getLifecycleManager(): LifecycleManager | null {
  return _manager;
}
