/**
 * Shared configuration — single source of truth for config directory path.
 */

export function getConfigDir(): string {
  return (
    process.env.SUPERHUMAN_CLI_CONFIG_DIR ||
    `${process.env.HOME}/.config/superhuman-cli`
  );
}
