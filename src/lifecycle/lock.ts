/**
 * Lifecycle lockfile — cooperative leader election among concurrent MCP server
 * instances.
 *
 * Multiple Claude Code sessions each spawn their own stdio MCP server, but only
 * ONE instance may own "app lifecycle duty" (launching Superhuman, health
 * monitoring). The leader holds a lockfile and heartbeats it via mtime; other
 * instances are followers and never launch or kill the app.
 *
 * Staleness: a lock is stale if its mtime stops advancing (leader hung/killed)
 * OR its pid is dead. Both checks are needed — the heartbeat protects against
 * PID reuse, and the pid check accelerates takeover after a crash.
 */

import {
  openSync,
  writeSync,
  closeSync,
  statSync,
  utimesSync,
  unlinkSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { getConfigDir } from "../config";
import { APP_VERSION } from "../version";

export interface LockInfo {
  pid: number;
  startedAt: string;
  version: string;
}

export interface LockReadResult {
  info: LockInfo | null; // null if the file exists but is unparseable
  mtimeMs: number;
}

export interface LockDeps {
  now(): number;
  pidAlive(pid: number): boolean;
  lockPath(): string;
  staleAfterMs: number;
}

/** 3× the health-tick interval — a live leader touches the lock every 30s. */
export const STALE_AFTER_MS = 90_000;

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but we can't signal it
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

export function defaultLockDeps(): LockDeps {
  return {
    now: Date.now,
    pidAlive: defaultPidAlive,
    lockPath: () => `${getConfigDir()}/lifecycle.lock`,
    staleAfterMs: Number(process.env.SUPERHUMAN_LOCK_STALE_MS) || STALE_AFTER_MS,
  };
}

/** Read the current lock file. Returns null if it doesn't exist. */
export function readLock(deps: LockDeps = defaultLockDeps()): LockReadResult | null {
  try {
    const path = deps.lockPath();
    const st = statSync(path);
    let info: LockInfo | null = null;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      if (typeof raw?.pid === "number") {
        info = { pid: raw.pid, startedAt: String(raw.startedAt ?? ""), version: String(raw.version ?? "") };
      }
    } catch {
      // Unparseable content — treated as stale by isLockStale
    }
    return { info, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/** A lock is stale if unparseable, its heartbeat stopped, or its owner is dead. */
export function isLockStale(read: LockReadResult, deps: LockDeps = defaultLockDeps()): boolean {
  if (!read.info) return true;
  if (deps.now() - read.mtimeMs > deps.staleAfterMs) return true;
  if (!deps.pidAlive(read.info.pid)) return true;
  return false;
}

/** Atomic create-exclusive. Returns false on EEXIST (someone else holds it). */
function tryCreate(path: string, content: string): boolean {
  try {
    const fd = openSync(path, "wx");
    try {
      writeSync(fd, content);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to become the leader. Returns true if this process now holds the lock.
 * If an existing lock is stale, it is removed and re-acquired; when two
 * candidates race, exactly one wins the create-exclusive.
 */
export function tryAcquireLock(deps: LockDeps = defaultLockDeps()): boolean {
  const path = deps.lockPath();
  try {
    mkdirSync(path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))), { recursive: true });
  } catch {
    // Directory may already exist
  }
  const content = JSON.stringify({
    pid: process.pid,
    startedAt: new Date(deps.now()).toISOString(),
    version: APP_VERSION,
  });

  if (tryCreate(path, content)) return true;

  const existing = readLock(deps);
  if (!existing) {
    // Lock vanished between attempts — retry once
    return tryCreate(path, content);
  }
  if (existing.info?.pid === process.pid) return true; // already ours
  if (!isLockStale(existing, deps)) return false;

  try {
    unlinkSync(path);
  } catch {
    // ENOENT (another candidate removed it first) is fine
  }
  return tryCreate(path, content);
}

/** Leader heartbeat — bump mtime so followers see the lock as live. */
export function heartbeatLock(deps: LockDeps = defaultLockDeps()): void {
  try {
    const t = new Date(deps.now());
    utimesSync(deps.lockPath(), t, t);
  } catch {
    // Lock may have been removed — verifyLockOwnership will catch it
  }
}

/** True if the lock file currently names this process. */
export function verifyLockOwnership(deps: LockDeps = defaultLockDeps()): boolean {
  const read = readLock(deps);
  return read?.info?.pid === process.pid;
}

/** Release the lock, but only if we still own it. */
export function releaseLock(deps: LockDeps = defaultLockDeps()): void {
  if (verifyLockOwnership(deps)) {
    try {
      unlinkSync(deps.lockPath());
    } catch {
      // Already gone
    }
  }
}
