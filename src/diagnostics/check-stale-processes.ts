#!/usr/bin/env bun
/**
 * Find stale/orphaned MCP server and Superhuman processes.
 *
 * Checks for:
 * - Bun processes running the MCP server health monitor
 * - Multiple Superhuman.exe instances (should be max 1 main + renderer children)
 * - Updater processes
 *
 * Usage: bun run src/diagnostics/check-stale-processes.ts
 */

import {
  getSuperhumanProcesses,
  getBunMcpProcesses,
  getUpdaterProcesses,
  countSuperhumanProcesses,
} from "./lib/process-utils";

function heading(text: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${text}`);
  console.log("=".repeat(60));
}

async function main(): Promise<void> {
  heading("SUPERHUMAN PROCESSES");
  const shProcs = await getSuperhumanProcesses();
  const totalCount = await countSuperhumanProcesses();

  if (shProcs.length === 0) {
    console.log("  No Superhuman.exe processes running");
  } else {
    console.log(`  Found ${totalCount} Superhuman.exe process(es):`);
    for (const p of shProcs) {
      const status = p.responding ? "responding" : "NOT RESPONDING";
      const window = p.windowTitle ? `"${p.windowTitle}"` : "(no window)";
      console.log(`  PID ${p.pid}: ${status} | ${window} | started ${p.startTime || "unknown"}`);
    }

    if (totalCount > 5) {
      console.log(`\n  ⚠ WARNING: ${totalCount} processes is unusually high.`);
      console.log(`  Normal is 1 main + 2-4 renderers. Multiple main processes could cause flashing.`);
    }
  }

  heading("BUN MCP SERVER PROCESSES");
  const bunProcs = await getBunMcpProcesses();

  if (bunProcs.length === 0) {
    console.log("  No bun MCP server processes found");
  } else {
    console.log(`  ⚠ Found ${bunProcs.length} MCP server process(es):`);
    for (const p of bunProcs) {
      console.log(`  PID ${p.pid}: ${p.commandLine}`);
    }
    console.log("\n  These may be running the 30s health monitor that auto-relaunches Superhuman.");
    console.log("  If stale, kill with: taskkill /PID <pid> /F");
  }

  heading("UPDATER PROCESSES");
  const updaters = await getUpdaterProcesses();

  if (updaters.length === 0) {
    console.log("  No updater processes running");
  } else {
    console.log(`  Found ${updaters.length} updater process(es):`);
    for (const p of updaters) {
      console.log(`  PID ${p.pid}: ${p.name}`);
    }
  }

  heading("DIAGNOSIS");
  const issues: string[] = [];

  if (bunProcs.length > 0) {
    issues.push(
      `STALE MCP: ${bunProcs.length} bun MCP server(s) found. ` +
        `These run a 30s health monitor that auto-relaunches Superhuman. ` +
        `PIDs: ${bunProcs.map((p) => p.pid).join(", ")}`
    );
  }

  if (totalCount > 5) {
    issues.push(
      `MULTIPLE INSTANCES: ${totalCount} Superhuman processes detected. ` +
        `This suggests multiple main processes competing.`
    );
  }

  if (updaters.length > 0) {
    issues.push(
      `ACTIVE UPDATER: ${updaters.length} updater process(es) detected. ` +
        `An active update installation could cause restart cycles.`
    );
  }

  if (issues.length === 0) {
    console.log("  No issues detected. System looks clean.");
  } else {
    for (const issue of issues) {
      console.log(`  ⚠ ${issue}`);
    }
  }
}

main().catch((e) => {
  console.error(`Fatal: ${(e as Error).message}`);
  process.exit(1);
});
