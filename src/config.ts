/**
 * Shared configuration — single source of truth for config directory path.
 */

import { homedir } from "node:os";

export function getConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return (
    process.env.SUPERHUMAN_CLI_CONFIG_DIR ||
    `${home}/.config/superhuman-cli`
  );
}
