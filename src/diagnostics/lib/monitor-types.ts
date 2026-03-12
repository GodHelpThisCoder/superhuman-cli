/**
 * Shared types and JSONL helpers for Superhuman diagnostics.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessInfo {
  pid: number;
  name: string;
  commandLine?: string;
  startTime?: string;
  responding?: boolean;
  windowTitle?: string;
}

export interface ProcessSample {
  timestamp: string;
  superhumanPids: number[];
  superhumanCount: number;
  cdpAvailable: boolean;
  cdpTargetCount: number;
  cdpTargetUrls: string[];
  bunMcpPids: number[];
  windowStates: { pid: number; title: string; responding: boolean }[];
  transitions: string[];
}

// ---------------------------------------------------------------------------
// JSONL Writer
// ---------------------------------------------------------------------------

const DIAG_DIR = join(
  process.env.SUPERHUMAN_CLI_CONFIG_DIR ||
    join(process.env.USERPROFILE || process.env.HOME || ".", ".config", "superhuman-cli"),
  "diagnostics"
);

export async function ensureDiagDir(): Promise<string> {
  await mkdir(DIAG_DIR, { recursive: true });
  return DIAG_DIR;
}

export async function getLogPath(filename: string): Promise<string> {
  const dir = await ensureDiagDir();
  return join(dir, filename);
}

export async function appendJsonl(filepath: string, record: unknown): Promise<void> {
  const { appendFile } = await import("node:fs/promises");
  const line = JSON.stringify(record) + "\n";
  await appendFile(filepath, line, "utf-8");
}

// ---------------------------------------------------------------------------
// Transition Detector
// ---------------------------------------------------------------------------

export class TransitionDetector {
  private lastPids: Set<number> = new Set();
  private lastCdpAvailable = false;
  private lastBunMcpPids: Set<number> = new Set();

  detect(sample: ProcessSample): string[] {
    const transitions: string[] = [];
    const currentPids = new Set(sample.superhumanPids);

    // New PIDs
    for (const pid of currentPids) {
      if (!this.lastPids.has(pid)) {
        transitions.push(`superhuman_started:pid=${pid}`);
      }
    }
    // Removed PIDs
    for (const pid of this.lastPids) {
      if (!currentPids.has(pid)) {
        transitions.push(`superhuman_stopped:pid=${pid}`);
      }
    }

    // CDP availability change
    if (sample.cdpAvailable !== this.lastCdpAvailable) {
      transitions.push(sample.cdpAvailable ? "cdp_became_available" : "cdp_became_unavailable");
    }

    // MCP bun process changes
    const currentBun = new Set(sample.bunMcpPids);
    for (const pid of currentBun) {
      if (!this.lastBunMcpPids.has(pid)) {
        transitions.push(`bun_mcp_started:pid=${pid}`);
      }
    }
    for (const pid of this.lastBunMcpPids) {
      if (!currentBun.has(pid)) {
        transitions.push(`bun_mcp_stopped:pid=${pid}`);
      }
    }

    this.lastPids = currentPids;
    this.lastCdpAvailable = sample.cdpAvailable;
    this.lastBunMcpPids = currentBun;

    return transitions;
  }

  reset(): void {
    this.lastPids.clear();
    this.lastCdpAvailable = false;
    this.lastBunMcpPids.clear();
  }
}
