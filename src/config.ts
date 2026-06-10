/**
 * Shared configuration — single source of truth for config directory path.
 */

import { homedir } from "node:os";

export function getConfigDir(): string {
  // Security note: SUPERHUMAN_CLI_CONFIG_DIR is a trust boundary.
  // If a caller points it to an untrusted/shared location, token/audit/kill-switch/
  // lifecycle-lock files may be exposed or tampered with (the lock now also makes
  // leader election boundary-dependent). Prefer the default per-user config path.
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return (
    process.env.SUPERHUMAN_CLI_CONFIG_DIR ||
    `${home}/.config/superhuman-cli`
  );
}
