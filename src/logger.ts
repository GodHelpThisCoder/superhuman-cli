/**
 * Structured logger — leveled, module-scoped logging to stderr + optional file.
 *
 * All output goes to stderr (stdout is reserved for MCP protocol).
 * File output: ~/.config/superhuman-cli/superhuman.log (rotated at 5MB).
 */

import { rename } from "node:fs/promises";
import { getConfigDir } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevelName = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Level management
// ---------------------------------------------------------------------------

const LEVELS: Record<LogLevelName, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let _level: number = LEVELS[resolveEnvLevel()];
let _levelName: LogLevelName = resolveEnvLevel();

function resolveEnvLevel(): LogLevelName {
  const env = process.env.SUPERHUMAN_LOG_LEVEL?.toLowerCase();
  if (env && env in LEVELS) return env as LogLevelName;
  return "info";
}

export function setLogLevel(level: LogLevelName): void {
  _level = LEVELS[level];
  _levelName = level;
}

export function getLogLevel(): LogLevelName {
  return _levelName;
}

// ---------------------------------------------------------------------------
// File logging (optional, fire-and-forget)
// ---------------------------------------------------------------------------

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

let _fileLoggingEnabled = false;
let _pendingWrite: Promise<void> | null = null;

/** Reset logger state (for tests only). */
export function _resetForTesting(): void {
  _level = LEVELS.info;
  _levelName = "info";
  _fileLoggingEnabled = false;
  _pendingWrite = null;
}

function logFilePath(): string {
  return `${getConfigDir()}/superhuman.log`;
}

/**
 * Enable file logging. Call once at startup. Safe to call multiple times.
 */
export async function initFileLogging(): Promise<void> {
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(getConfigDir(), { recursive: true });
    _fileLoggingEnabled = true;
  } catch {
    // Best-effort — if we can't create the dir, skip file logging
  }
}

async function writeToFile(line: string): Promise<void> {
  if (!_fileLoggingEnabled) return;
  try {
    const path = logFilePath();
    const file = Bun.file(path);

    // Rotate if over 5MB
    if (await file.exists() && file.size > MAX_LOG_SIZE) {
      await rename(path, `${path}.1`).catch(() => {});
    }

    const current = await Bun.file(path).text().catch(() => "");
    await Bun.write(path, current + line);
  } catch {
    // Fire-and-forget — never block on file write failures
  }
}

// ---------------------------------------------------------------------------
// Core logging
// ---------------------------------------------------------------------------

function formatLine(level: LogLevelName, module: string, msg: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  const extra = args.length > 0
    ? " " + args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    : "";
  return `[${ts}] [${tag}] [${module}] ${msg}${extra}`;
}

function emit(level: LogLevelName, module: string, msg: string, args: unknown[]): void {
  if (LEVELS[level] < _level) return;

  const line = formatLine(level, module, msg, args);
  console.error(line);

  if (_fileLoggingEnabled) {
    // Chain file writes to avoid interleaving, fire-and-forget
    _pendingWrite = (_pendingWrite ?? Promise.resolve())
      .then(() => writeToFile(line + "\n"))
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a logger scoped to a module name.
 *
 * ```ts
 * const log = createLogger("cdp");
 * log.info("Connected to Superhuman");
 * log.debug("CDP target:", targetId);
 * ```
 */
export function createLogger(module: string): Logger {
  return {
    debug: (msg: string, ...args: unknown[]) => emit("debug", module, msg, args),
    info: (msg: string, ...args: unknown[]) => emit("info", module, msg, args),
    warn: (msg: string, ...args: unknown[]) => emit("warn", module, msg, args),
    error: (msg: string, ...args: unknown[]) => emit("error", module, msg, args),
  };
}
