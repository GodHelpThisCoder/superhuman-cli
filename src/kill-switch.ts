/**
 * Kill Switch — sentinel file that suspends all mutating operations.
 *
 * When ~/.config/superhuman-cli/kill-switch exists, every mutating handler
 * refuses execution immediately. Optional file content is used as a reason.
 */

// Intentional exception to Bun.file preference: guard checks must be synchronous
// to avoid any async gap between kill-switch detection and mutation execution.
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { getConfigDir } from "./config";
import { logAudit } from "./audit";

function killSwitchPath(): string {
  return `${getConfigDir()}/kill-switch`;
}

/**
 * Check if the kill switch is active (synchronous — no async gap before execution).
 */
export function isKilled(): { killed: boolean; reason?: string } {
  const path = killSwitchPath();
  if (!existsSync(path)) {
    return { killed: false };
  }
  try {
    const content = readFileSync(path, "utf-8").trim();
    return { killed: true, reason: content || undefined };
  } catch {
    return { killed: true };
  }
}

/**
 * Activate the kill switch. Creates the sentinel file with an optional reason.
 */
export function activate(reason?: string): void {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(killSwitchPath(), reason || "");
  logAudit({
    tool: "superhuman_kill_switch",
    account: "unknown",
    action: "killed",
    args: { state: "activated", reason: reason || "" },
    result: "success",
    dryRun: false,
  }).catch(() => {});
}

/**
 * Deactivate the kill switch. Removes the sentinel file.
 */
export function deactivate(): void {
  const path = killSwitchPath();
  if (existsSync(path)) {
    unlinkSync(path);
    logAudit({
      tool: "superhuman_kill_switch",
      account: "unknown",
      action: "executed",
      args: { state: "deactivated" },
      result: "success",
      dryRun: false,
    }).catch(() => {});
  }
}
