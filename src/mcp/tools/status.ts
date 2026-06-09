/**
 * MCP tool handler for server + Superhuman app health/lifecycle status.
 *
 * Read-only and fast (<1s): a live CDP probe and file-based pending-update
 * check only — no token loading, no process scans.
 */

import { z } from "zod";
import { successResult, errorResult, CDP_PORT, type ToolResult } from "./shared";
import { getLifecycleManager } from "../../lifecycle/manager";
import { isSuperhumanRunning } from "../../cdp/connection";
import { getPendingUpdateInfo } from "../../update-awareness";
import { formatDuration } from "../../doctor";
import { APP_VERSION } from "../../version";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const StatusSchema = z.object({}).strict();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function statusHandler(_args: z.infer<typeof StatusSchema>): Promise<ToolResult> {
  try {
    const lines: string[] = [];
    lines.push(`superhuman-cli MCP server v${APP_VERSION} (pid ${process.pid})`);

    // Lifecycle status (set by the MCP entry point; absent in CLI mode)
    const manager = getLifecycleManager();
    if (manager) {
      const s = manager.getStatus();
      const inState = formatDuration(Math.max(0, Date.now() - s.sinceMs));
      lines.push(
        `Lifecycle: state=${s.state} (for ${inState}), role=${s.isLeader ? "leader" : "follower"}, ` +
          `leaderPid=${s.leaderPid ?? "unknown"}` +
          (s.detail ? `, detail=${s.detail}` : "")
      );
    } else {
      lines.push("Lifecycle: lifecycle manager not running");
    }

    // Live CDP probe
    let cdpReachable: boolean | null = null;
    try {
      cdpReachable = await isSuperhumanRunning(CDP_PORT);
    } catch {
      cdpReachable = null;
    }
    lines.push(
      `CDP (port ${CDP_PORT}): ${cdpReachable === null ? "unknown (probe failed)" : cdpReachable ? "reachable" : "unreachable"}`
    );

    // Pending update (file read only — isUpdaterRunning would spawn a process scan)
    try {
      const pending = await getPendingUpdateInfo();
      lines.push(`Pending update: ${pending ? `v${pending.version} (${pending.fileName})` : "none"}`);
    } catch {
      lines.push("Pending update: unknown (probe failed)");
    }

    lines.push("For full diagnostics (tokens, lock, shortcuts), run 'superhuman doctor' in a terminal.");

    return successResult(lines.join("\n"));
  } catch (error) {
    return errorResult(`Failed to collect status: ${error instanceof Error ? error.message : String(error)}`);
  }
}
