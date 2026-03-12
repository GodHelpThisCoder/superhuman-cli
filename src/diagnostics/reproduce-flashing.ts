#!/usr/bin/env bun
/**
 * Controlled reproduction tests for Superhuman flash/restart behavior.
 *
 * Tests:
 *   A: Health monitor + external kill → does the monitor create a restart loop?
 *   B: Passive observation with pending update → does the updater trigger restarts?
 *   C: Rapid CDP connect/disconnect → does this destabilize the app?
 *   D: Concurrent launchSuperhuman() calls → do we get duplicate instances?
 *
 * Usage:
 *   bun run src/diagnostics/reproduce-flashing.ts [--test A|B|C|D|all]
 *
 * Each test runs the process monitor in the background and analyzes
 * the JSONL output for rapid start/stop patterns.
 */

import CDP from "chrome-remote-interface";
import { getSuperhumanProcesses, countSuperhumanProcesses } from "./lib/process-utils";
import { TransitionDetector, appendJsonl, getLogPath } from "./lib/monitor-types";
import type { ProcessSample } from "./lib/monitor-types";
import { isSuperhumanRunning, launchSuperhuman } from "../cdp/connection";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9333", 10);

// ---------------------------------------------------------------------------
// Inline mini-monitor (reuses the same logic as process-monitor.ts)
// ---------------------------------------------------------------------------

interface MonitorHandle {
  stop: () => void;
  getSamples: () => ProcessSample[];
}

function startMiniMonitor(intervalMs = 2000): MonitorHandle {
  const samples: ProcessSample[] = [];
  const detector = new TransitionDetector();

  const interval = setInterval(async () => {
    try {
      const shProcs = await getSuperhumanProcesses();
      let cdpResult: { available: boolean; targets: any[] };
      try {
        const targets = await CDP.List({ port: CDP_PORT, host: "localhost" });
        cdpResult = { available: true, targets };
      } catch {
        cdpResult = { available: false, targets: [] };
      }

      const sample: ProcessSample = {
        timestamp: new Date().toISOString(),
        superhumanPids: shProcs.map((p) => p.pid),
        superhumanCount: shProcs.length,
        cdpAvailable: cdpResult.available,
        cdpTargetCount: cdpResult.targets.length,
        cdpTargetUrls: cdpResult.targets.map((t: any) => t.url),
        bunMcpPids: [],
        windowStates: shProcs.map((p) => ({
          pid: p.pid,
          title: p.windowTitle || "",
          responding: p.responding ?? true,
        })),
        transitions: [],
      };
      sample.transitions = detector.detect(sample);
      samples.push(sample);

      if (sample.transitions.length > 0) {
        console.error(`  [monitor] ${sample.timestamp} >>> ${sample.transitions.join(", ")}`);
      }
    } catch {
      // ignore sample errors
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(interval),
    getSamples: () => samples,
  };
}

function analyzeForFlashing(samples: ProcessSample[]): {
  restartCycles: number;
  rapidTransitions: string[];
  verdict: string;
} {
  let restartCycles = 0;
  const rapidTransitions: string[] = [];

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const curr = samples[i]!;

    // Detect rapid start/stop within short windows
    const hasStop = curr.transitions.some((t) => t.startsWith("superhuman_stopped"));
    const hasStart = curr.transitions.some((t) => t.startsWith("superhuman_started"));

    if (hasStop && hasStart) {
      restartCycles++;
      rapidTransitions.push(`${curr.timestamp}: stop+start in same sample`);
    }

    // Also check consecutive samples for stop→start
    if (
      prev.transitions.some((t) => t.startsWith("superhuman_stopped")) &&
      curr.transitions.some((t) => t.startsWith("superhuman_started"))
    ) {
      restartCycles++;
      rapidTransitions.push(`${prev.timestamp}→${curr.timestamp}: stop then start`);
    }
  }

  let verdict: string;
  if (restartCycles >= 3) {
    verdict = "FLASHING REPRODUCED — multiple rapid restart cycles detected";
  } else if (restartCycles > 0) {
    verdict = `PARTIAL — ${restartCycles} restart cycle(s) detected, not enough for definitive flashing`;
  } else {
    verdict = "NOT REPRODUCED — no rapid restart cycles observed";
  }

  return { restartCycles, rapidTransitions, verdict };
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Test A: Health monitor + external kill
// ---------------------------------------------------------------------------

async function testA(): Promise<void> {
  console.log("\n--- TEST A: Health monitor + external kill ---");
  console.log("Simulates the MCP health monitor behavior when Superhuman dies.");

  // Ensure Superhuman is running
  console.log("  Launching Superhuman...");
  const launched = await launchSuperhuman(CDP_PORT);
  if (!launched) {
    console.log("  SKIP: Could not launch Superhuman");
    return;
  }

  const monitor = startMiniMonitor(1500);
  console.log("  Monitoring started. Waiting 5s for baseline...");
  await wait(5000);

  // Start a health monitor (same as index.ts)
  let healthRunning = true;
  const healthInterval = setInterval(async () => {
    if (!healthRunning) return;
    if (!(await isSuperhumanRunning(CDP_PORT))) {
      console.error("  [health] Superhuman not detected, relaunching...");
      await launchSuperhuman(CDP_PORT);
    }
  }, 5000); // 5s for faster testing (production is 30s)

  // Kill Superhuman externally
  console.log("  Killing Superhuman via taskkill...");
  const procs = await getSuperhumanProcesses();
  for (const p of procs) {
    try {
      Bun.spawn(["taskkill", "/PID", String(p.pid), "/F"], { stdout: "ignore", stderr: "ignore" });
    } catch {}
  }

  // Watch for 30 seconds
  console.log("  Observing for 30s...");
  await wait(30000);

  // Stop health monitor
  healthRunning = false;
  clearInterval(healthInterval);

  // Stop mini-monitor and analyze
  monitor.stop();
  const result = analyzeForFlashing(monitor.getSamples());

  console.log(`\n  Result: ${result.verdict}`);
  console.log(`  Restart cycles: ${result.restartCycles}`);
  for (const t of result.rapidTransitions) {
    console.log(`    ${t}`);
  }
}

// ---------------------------------------------------------------------------
// Test B: Passive observation with pending update
// ---------------------------------------------------------------------------

async function testB(): Promise<void> {
  console.log("\n--- TEST B: Passive observation with pending update ---");
  console.log("Watches Superhuman for 60s to see if the auto-updater triggers restarts.");

  if (!(await isSuperhumanRunning(CDP_PORT))) {
    console.log("  Launching Superhuman...");
    const launched = await launchSuperhuman(CDP_PORT);
    if (!launched) {
      console.log("  SKIP: Could not launch Superhuman");
      return;
    }
  }

  const monitor = startMiniMonitor(2000);
  console.log("  Monitoring for 60s (watching for updater-triggered restarts)...");
  await wait(60000);

  monitor.stop();
  const result = analyzeForFlashing(monitor.getSamples());

  console.log(`\n  Result: ${result.verdict}`);
  console.log(`  Restart cycles: ${result.restartCycles}`);
  if (result.restartCycles === 0) {
    console.log("  The auto-updater did NOT trigger restarts during this window.");
    console.log("  Note: The updater may only trigger on app quit, not while running.");
  }
}

// ---------------------------------------------------------------------------
// Test C: Rapid CDP connect/disconnect
// ---------------------------------------------------------------------------

async function testC(): Promise<void> {
  console.log("\n--- TEST C: Rapid CDP connect/disconnect ---");
  console.log("Connects and disconnects CDP 10 times in rapid succession.");

  if (!(await isSuperhumanRunning(CDP_PORT))) {
    console.log("  Launching Superhuman...");
    const launched = await launchSuperhuman(CDP_PORT);
    if (!launched) {
      console.log("  SKIP: Could not launch Superhuman");
      return;
    }
  }

  const monitor = startMiniMonitor(1000);
  console.log("  Waiting 3s for baseline...");
  await wait(3000);

  console.log("  Rapid CDP connect/disconnect x10...");
  for (let i = 0; i < 10; i++) {
    try {
      const targets = await CDP.List({ port: CDP_PORT, host: "localhost" });
      const mainPage = targets.find(
        (t: any) => t.url.includes("mail.superhuman.com") && t.type === "page"
      );
      if (mainPage) {
        const client = await CDP({ target: mainPage.id, port: CDP_PORT, host: "localhost" });
        await client.close();
      }
    } catch (e) {
      console.error(`  [cdp-stress] Attempt ${i + 1} error: ${(e as Error).message}`);
    }
    await wait(200); // 200ms between attempts
  }

  console.log("  Observing for 15s after stress...");
  await wait(15000);

  monitor.stop();
  const result = analyzeForFlashing(monitor.getSamples());

  console.log(`\n  Result: ${result.verdict}`);
  console.log(`  Restart cycles: ${result.restartCycles}`);
}

// ---------------------------------------------------------------------------
// Test D: Concurrent launch calls
// ---------------------------------------------------------------------------

async function testD(): Promise<void> {
  console.log("\n--- TEST D: Concurrent launchSuperhuman() calls ---");
  console.log("Calls launchSuperhuman() twice simultaneously to check for race conditions.");

  // First kill any running Superhuman
  const procs = await getSuperhumanProcesses();
  for (const p of procs) {
    try {
      Bun.spawn(["taskkill", "/PID", String(p.pid), "/F"], { stdout: "ignore", stderr: "ignore" });
    } catch {}
  }
  await wait(3000);

  const monitor = startMiniMonitor(1000);

  console.log("  Launching two concurrent launchSuperhuman() calls...");
  const [result1, result2] = await Promise.all([
    launchSuperhuman(CDP_PORT),
    launchSuperhuman(CDP_PORT),
  ]);
  console.log(`  Launch 1: ${result1}, Launch 2: ${result2}`);

  console.log("  Checking process count...");
  await wait(5000);
  const count = await countSuperhumanProcesses();
  console.log(`  Superhuman.exe process count: ${count}`);

  await wait(10000);
  monitor.stop();

  const analysis = analyzeForFlashing(monitor.getSamples());
  console.log(`\n  Result: ${analysis.verdict}`);
  console.log(`  Restart cycles: ${analysis.restartCycles}`);

  if (count > 6) {
    console.log(`  ⚠ WARNING: ${count} processes suggests duplicate main processes were launched!`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const testArg = process.argv.find((_, i) => process.argv[i - 1] === "--test") || "all";

  console.log("=== Superhuman Flash/Restart Reproduction Tests ===");
  console.log(`CDP port: ${CDP_PORT}`);
  console.log(`Selected test: ${testArg}\n`);

  const tests: Record<string, () => Promise<void>> = {
    A: testA,
    B: testB,
    C: testC,
    D: testD,
  };

  if (testArg.toLowerCase() === "all") {
    for (const [name, fn] of Object.entries(tests)) {
      try {
        await fn();
      } catch (e) {
        console.error(`\n  TEST ${name} FAILED: ${(e as Error).message}`);
      }
    }
  } else {
    const fn = tests[testArg.toUpperCase()];
    if (!fn) {
      console.error(`Unknown test: ${testArg}. Available: A, B, C, D, all`);
      process.exit(1);
    }
    await fn();
  }

  console.log("\n=== Tests complete ===");
}

main().catch((e) => {
  console.error(`Fatal: ${(e as Error).message}`);
  process.exit(1);
});
