/**
 * Kill Switch — sentinel file that suspends all mutating operations.
 *
 * When ~/.config/superhuman-cli/kill-switch exists, every mutating handler
 * refuses execution immediately. Optional file content is used as a reason.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { getConfigDir } from "./config";

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
}

/**
 * Deactivate the kill switch. Removes the sentinel file.
 */
export function deactivate(): void {
  const path = killSwitchPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
