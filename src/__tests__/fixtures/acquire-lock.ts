/**
 * Test fixture: single lock-acquisition attempt in a real separate process.
 *
 * Spawned by lifecycle-lock.test.ts (multi-process contention tests) with
 * SUPERHUMAN_CLI_CONFIG_DIR pointing at a per-test temp dir. Prints exactly
 * one line — "LEADER" or "FOLLOWER" — then exits WITHOUT releasing the lock
 * (deliberately simulating a leader that crashed/was killed, so the test can
 * verify dead-pid takeover afterwards).
 *
 * Determinism: each FOLLOWER drops a `follower-<pid>.done` marker file in the
 * config dir before exiting. The LEADER holds the lock (stays alive) until
 * LOCK_FIXTURE_FOLLOWERS marker files exist, so no concurrent candidate can
 * ever observe the leader's pid as dead and steal the lock mid-test. Without
 * this rendezvous the test would race: a slow-starting candidate could see a
 * fresh lock whose owner already exited and legitimately take over, producing
 * two LEADER lines.
 */

import { readdirSync, writeFileSync } from "node:fs";
import { tryAcquireLock, defaultLockDeps } from "../../lifecycle/lock";

const configDir = process.env.SUPERHUMAN_CLI_CONFIG_DIR;
if (!configDir) {
  console.error("acquire-lock fixture requires SUPERHUMAN_CLI_CONFIG_DIR");
  process.exit(2);
}

const expectedFollowers = Number(process.env.LOCK_FIXTURE_FOLLOWERS || "0");

const isLeader = tryAcquireLock(defaultLockDeps());
console.log(isLeader ? "LEADER" : "FOLLOWER");

if (!isLeader) {
  // Signal the leader that this candidate has finished observing the lock.
  writeFileSync(`${configDir}/follower-${process.pid}.done`, "");
} else if (expectedFollowers > 0) {
  // Hold the lock until every follower has come and gone (bounded wait so a
  // broken test never hangs the fixture forever).
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const done = readdirSync(configDir).filter((f) => f.startsWith("follower-")).length;
    if (done >= expectedFollowers) break;
    await Bun.sleep(50);
  }
}

// Exit without releaseLock() — the lock file must survive with a dead pid.
