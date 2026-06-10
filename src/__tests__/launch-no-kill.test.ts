/**
 * Source-level regression tripwire for src/cdp/connection.ts launch behavior.
 *
 * WHY A TEXT-LEVEL TEST: launchSuperhuman() intentionally has no dependency
 * injection (it talks to the real OS: Bun.spawn, CDP probes, updater checks),
 * and refactoring it for injectability was deliberately rejected — the
 * lifecycle work is concurrent with other edits to this file and the function
 * is the system's most safety-critical code path. Instead this test reads the
 * source as text and trips if the dangerous patterns ever come back:
 *
 *   1. KILL-ON-TIMEOUT — the old code called launchedSuperhumanProcess.kill()
 *      when the 30s readiness wait expired. During an Electron auto-update the
 *      app legitimately takes 30-120s to come up, so the kill murdered
 *      Superhuman mid-update (and could kill an instance the user was actively
 *      working in). The fix removed every kill() on the launched process; the
 *      timeout path now just logs and leaves the process alone.
 *
 *   2. PROCESS TIED TO SERVER LIFETIME — the spawned app must be unref()ed so
 *      a dying MCP server never drags Superhuman down with it.
 *
 *   3. SINGLE-INSTANCE SPAWN LOOP — spawning while a debug-port-less
 *      Superhuman is already running just defers to Electron's single-instance
 *      lock and exits, so launchSuperhuman must check
 *      isSuperhumanProcessRunning() BEFORE Bun.spawn and refuse.
 *
 * If this test fails after an intentional change, update the rationale here —
 * do not silently delete the assertion.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONNECTION_SRC = join(import.meta.dir, "..", "cdp", "connection.ts");
const source = readFileSync(CONNECTION_SRC, "utf8");

describe("launchSuperhuman never-kill guard (source-level)", () => {
  test("never calls kill() on the launched Superhuman process", () => {
    // Matches launchedSuperhumanProcess.kill(...) and launchedSuperhumanProcess?.kill(...)
    expect(source).not.toMatch(/launchedSuperhumanProcess\s*\??\.\s*kill\s*\(/);
    expect(source).not.toContain("launchedSuperhumanProcess?.kill()");
    expect(source).not.toContain("launchedSuperhumanProcess.kill()");
  });

  test("detaches the spawned process from the server's lifetime (unref)", () => {
    expect(source).toContain("unref()");
  });

  test("guards against single-instance spawn loop BEFORE spawning", () => {
    const fnStart = source.indexOf("export async function launchSuperhuman");
    expect(fnStart).toBeGreaterThan(-1);
    const spawnIdx = source.indexOf("Bun.spawn", fnStart);
    expect(spawnIdx).toBeGreaterThan(fnStart);

    // The pre-spawn section of launchSuperhuman must consult the
    // process-presence probe (running-without-debug-port detection).
    const preSpawn = source.slice(fnStart, spawnIdx);
    expect(preSpawn).toContain("isSuperhumanProcessRunning()");
  });

  test("documents the never-kill-on-timeout decision at the timeout site", () => {
    // The comment is part of the contract: whoever re-adds a kill must
    // consciously delete the explanation of why killing was removed.
    expect(source.toLowerCase()).toContain("never kill on timeout");
  });
});
