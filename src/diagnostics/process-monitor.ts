#!/usr/bin/env bun
/**
 * Real-time Superhuman process & CDP monitor.
 *
 * Polls every 2 seconds and logs:
 * - Superhuman.exe processes (PIDs, window state)
 * - CDP port 9333 availability and targets
 * - Bun MCP server processes (stale health monitors)
 * - State transitions (start/stop/CDP up/down)
 *
 * Usage:
 *   bun run src/diagnostics/process-monitor.ts [--duration <seconds>]
 *
 * Output: JSONL to ~/.config/superhuman-cli/diagnostics/process-monitor.jsonl + stderr
 */

import CDP from "chrome-remote-interface";
import { getSuperhumanProcesses, getBunMcpProcesses } from "./lib/process-utils";
import { TransitionDetector, appendJsonl, getLogPath } from "./lib/monitor-types";
import type { ProcessSample } from "./lib/monitor-types";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_CDP_PORT = parseInt(process.env.CDP_PORT || "9333", 10);

// Parse --duration flag (seconds, 0 = indefinite)
const durationArg = process.argv.find((_, i) => process.argv[i - 1] === "--duration");
const durationMs = durationArg ? parseInt(durationArg, 10) * 1000 : 0;

const detector = new TransitionDetector();
let logPath: string;
let sampleCount = 0;
let transitionCount = 0;
const startTime = Date.now();

async function probeCDP(port: number): Promise<{ available: boolean; targets: any[] }> {
  try {
    const targets = await CDP.List({ port, host: "localhost" });
    return { available: true, targets };
  } catch {
    return { available: false, targets: [] };
  }
}

async function takeSample(): Promise<ProcessSample> {
  const [shProcs, bunProcs, cdp] = await Promise.all([
    getSuperhumanProcesses(),
    getBunMcpProcesses(),
    probeCDP(DEFAULT_CDP_PORT),
  ]);

  const sample: ProcessSample = {
    timestamp: new Date().toISOString(),
    superhumanPids: shProcs.map((p) => p.pid),
    superhumanCount: shProcs.length,
    cdpAvailable: cdp.available,
    cdpTargetCount: cdp.targets.length,
    cdpTargetUrls: cdp.targets.map((t: any) => t.url),
    bunMcpPids: bunProcs.map((p) => p.pid),
    windowStates: shProcs.map((p) => ({
      pid: p.pid,
      title: p.windowTitle || "",
      responding: p.responding ?? true,
    })),
    transitions: [],
  };

  sample.transitions = detector.detect(sample);
  return sample;
}

function formatSample(s: ProcessSample): string {
  const parts = [
    `[${s.timestamp}]`,
    `SH:${s.superhumanCount}pids=${s.superhumanPids.join(",")}`,
    `CDP:${s.cdpAvailable ? "UP" : "DOWN"}(${s.cdpTargetCount})`,
    s.bunMcpPids.length > 0 ? `MCP:${s.bunMcpPids.join(",")}` : null,
    s.transitions.length > 0 ? `>>> ${s.transitions.join(", ")}` : null,
  ];
  return parts.filter(Boolean).join(" | ");
}

async function run(): Promise<void> {
  logPath = await getLogPath("process-monitor.jsonl");
  console.error(`[process-monitor] Logging to ${logPath}`);
  console.error(`[process-monitor] Polling every ${POLL_INTERVAL_MS}ms, CDP port ${DEFAULT_CDP_PORT}`);
  if (durationMs > 0) {
    console.error(`[process-monitor] Will run for ${durationMs / 1000}s`);
  }
  console.error("---");

  const interval = setInterval(async () => {
    try {
      const sample = await takeSample();
      sampleCount++;
      if (sample.transitions.length > 0) transitionCount += sample.transitions.length;

      // Always log to file
      await appendJsonl(logPath, sample);

      // Print to stderr: always show transitions, otherwise every 5th sample
      if (sample.transitions.length > 0 || sampleCount % 5 === 0) {
        console.error(formatSample(sample));
      }

      // Check duration
      if (durationMs > 0 && Date.now() - startTime >= durationMs) {
        clearInterval(interval);
        printSummary();
      }
    } catch (e) {
      console.error(`[process-monitor] Sample error: ${(e as Error).message}`);
    }
  }, POLL_INTERVAL_MS);

  // Graceful shutdown
  const cleanup = () => {
    clearInterval(interval);
    printSummary();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

function printSummary(): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error("\n--- SUMMARY ---");
  console.error(`Duration: ${elapsed}s | Samples: ${sampleCount} | Transitions: ${transitionCount}`);
  console.error(`Log file: ${logPath}`);
}

run().catch((e) => {
  console.error(`[process-monitor] Fatal: ${(e as Error).message}`);
  process.exit(1);
});
