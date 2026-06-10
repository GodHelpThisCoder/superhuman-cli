#!/usr/bin/env bun
/**
 * Superhuman CLI — diagnostics only.
 *
 * The CLI is a connection/diagnostics companion to the MCP server.
 * All email, label, calendar, and compose operations live in the MCP
 * server (`bun run src/index.ts --mcp`), not here.
 *
 * Usage:
 *   superhuman status
 *   superhuman doctor [--fix-port | --patch-shortcut]
 *   superhuman launch
 *   superhuman logs [-n <num>] [--follow]
 *   superhuman kill [reason] | unkill
 *   superhuman account list|auth
 */

import { stat } from "node:fs/promises";
import {
  connectToSuperhuman,
  disconnect,
  disconnectChrome,
  connectToSuperhumanChrome,
  getSuperhumanPath,
  ensureSuperhuman,
  type SuperhumanConnection,
} from "./superhuman-api";
import { listAccounts, listAccountsChrome, type Account } from "./accounts";
import {
  getToken,
  saveTokensToDisk,
  getTokensFilePath,
  extractTokenChrome,
} from "./token-api";
import { activate as killActivate, deactivate as killDeactivate, isKilled } from "./kill-switch";
import { getConfigDir } from "./config";
import { APP_VERSION } from "./version";
import { setLogLevel, createLogger } from "./logger";

const _cliLog = createLogger("cli");

const VERSION = APP_VERSION;
const CDP_PORT = parseInt(process.env.CDP_PORT || "9333", 10);

// Handle --verbose flag early, before subcommand parsing
if (process.argv.includes("--verbose") || process.env.SUPERHUMAN_LOG_LEVEL === "debug") {
  setLogLevel("debug");
}
// Strip --verbose from argv so it doesn't interfere with subcommand dispatch
const _verboseIdx = process.argv.indexOf("--verbose");
if (_verboseIdx !== -1) process.argv.splice(_verboseIdx, 1);

/** Format the Superhuman path for display (quotes paths with spaces). */
function getSuperhumanCommand(): string {
  const p = getSuperhumanPath();
  return p.includes(" ") ? `"${p}"` : p;
}

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function log(message: string) {
  console.log(message);
}

function success(message: string) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function error(message: string) {
  console.error(`${colors.red}✗${colors.reset} ${message}`);
}

function info(message: string) {
  console.log(`${colors.blue}ℹ${colors.reset} ${message}`);
}

/**
 * Format accounts list for human-readable output
 */
export function formatAccountsList(accounts: Account[]): string {
  if (accounts.length === 0) return "";

  return accounts
    .map((account, index) => {
      const marker = account.isCurrent ? "*" : " ";
      const suffix = account.isCurrent ? " (current)" : "";
      return `${marker} ${index + 1}. ${account.email}${suffix}`;
    })
    .join("\n");
}

/**
 * Format accounts list as JSON
 */
export function formatAccountsJson(accounts: Account[]): string {
  return JSON.stringify(accounts);
}

function printHelp() {
  console.log(`
${colors.bold}Superhuman CLI${colors.reset} v${VERSION} ${colors.dim}(diagnostics)${colors.reset}

${colors.bold}USAGE${colors.reset}
  superhuman <command> [subcommand] [options]

${colors.bold}COMMANDS${colors.reset}
  ${colors.cyan}status${colors.reset}              Check Superhuman connection status
  ${colors.cyan}doctor${colors.reset}              Run full diagnostics (CDP, process, lock, updates, tokens, shortcuts)
  ${colors.cyan}launch${colors.reset}              Ensure Superhuman is running with the CDP debug port
  ${colors.cyan}logs${colors.reset}                Print recent lines from the superhuman-cli log file
  ${colors.cyan}kill${colors.reset} [reason]        Activate kill switch — suspend all mutations
  ${colors.cyan}unkill${colors.reset}              Deactivate kill switch — resume mutations
  ${colors.cyan}account${colors.reset} list        List linked Superhuman accounts
  ${colors.cyan}account${colors.reset} auth        Extract and cache auth tokens (connection repair)
  ${colors.cyan}help${colors.reset}                Show this help message

${colors.bold}OPTIONS${colors.reset}
  --port <number>    CDP port (default: ${CDP_PORT})
  --json             Output as JSON (for account list)
  -n <number>        Number of log lines to print (for logs, default: 50)
  --follow           Keep printing new log lines, 1s poll (for logs, Ctrl+C to stop)
  --fix-port         (doctor) Gracefully restart Superhuman with the debug port — never force-kills
  --patch-shortcut   (doctor) Add the debug-port flag to Windows shortcuts (app updates revert this)
  --verbose          Enable debug logging
  --version, -v      Print version

${colors.bold}EXAMPLES${colors.reset}
  ${colors.dim}# Diagnostics${colors.reset}
  superhuman status
  superhuman doctor
  superhuman doctor --fix-port
  superhuman doctor --patch-shortcut

  ${colors.dim}# Launch Superhuman with the debug port${colors.reset}
  superhuman launch
  superhuman launch --port 9333

  ${colors.dim}# Logs${colors.reset}
  superhuman logs
  superhuman logs -n 200
  superhuman logs --follow

  ${colors.dim}# Kill switch${colors.reset}
  superhuman kill "maintenance window"
  superhuman unkill

  ${colors.dim}# Accounts${colors.reset}
  superhuman account list
  superhuman account list --json
  superhuman account auth

${colors.bold}NOTE${colors.reset}
  Email, label, calendar, and compose operations are served by the MCP
  server (45 tools): ${colors.dim}bun run src/index.ts --mcp${colors.reset}

${colors.bold}REQUIREMENTS${colors.reset}
  Superhuman must be running with remote debugging enabled:
  ${colors.dim}${getSuperhumanCommand()} --remote-debugging-port=${CDP_PORT}${colors.reset}
`);
}

// Commands that use noun+verb subcommand groups (e.g., "account list")
const GROUPED_COMMANDS = new Set(["account"]);

interface CliOptions {
  command: string;
  subcommand: string;
  port: number;
  json: boolean;
  // logs options
  lines: number; // -n <num>: number of log lines to print
  follow: boolean; // --follow: poll for new log content
  // kill option
  killReason: string; // optional positional reason for the kill command
  // doctor options
  fixPort: boolean; // doctor --fix-port: gracefully restart Superhuman with the debug port
  patchShortcut: boolean; // doctor --patch-shortcut: add debug port flag to Windows shortcuts
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    command: "",
    subcommand: "",
    port: CDP_PORT,
    json: false,
    lines: 50,
    follow: false,
    killReason: "",
    fixPort: false,
    patchShortcut: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg === "-n") {
      const value = args[i + 1];
      if (value === undefined || Number.isNaN(parseInt(value, 10))) {
        error("-n requires a numeric value");
        process.exit(1);
      }
      options.lines = parseInt(value, 10);
      i += 2;
    } else if (arg.startsWith("--")) {
      // Support both --key value and --key=value formats
      let key: string;
      let value: string | undefined;
      let usedEqualsFormat = false;
      const equalIndex = arg.indexOf("=");
      if (equalIndex !== -1) {
        key = arg.slice(2, equalIndex);
        value = arg.slice(equalIndex + 1);
        usedEqualsFormat = true;
      } else {
        key = arg.slice(2);
        value = args[i + 1];
      }
      // Helper to increment by correct amount based on format
      const inc = usedEqualsFormat ? 1 : 2;

      // Validate that flags requiring a value actually have one
      if (!usedEqualsFormat && (value === undefined || value?.startsWith("--"))) {
        const needsValue = ["port"];
        if (needsValue.includes(key)) {
          error(`--${key} requires a value`);
          process.exit(1);
        }
      }

      switch (key) {
        case "port":
          options.port = parseInt(value!, 10);
          i += inc;
          break;
        case "help":
          options.command = "help";
          i += 1;
          break;
        case "json":
          options.json = true;
          i += 1;
          break;
        case "follow":
          options.follow = true;
          i += 1;
          break;
        case "fix-port":
          options.fixPort = true;
          i += 1;
          break;
        case "patch-shortcut":
          options.patchShortcut = true;
          i += 1;
          break;
        case "fix-port":
          options.fixPort = true;
          i += 1;
          break;
        case "patch-shortcut":
          options.patchShortcut = true;
          i += 1;
          break;
        default:
          error(`Unknown option: ${arg}`);
          process.exit(1);
      }
    } else if (!options.command) {
      options.command = arg;
      i += 1;
    } else if (GROUPED_COMMANDS.has(options.command) && !options.subcommand) {
      // Second positional arg for grouped commands is the subcommand
      options.subcommand = arg;
      i += 1;
    } else if (options.command === "kill" && !options.killReason) {
      // kill <reason> — reason is an optional positional arg
      options.killReason = arg;
      i += 1;
    } else {
      error(`Unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

async function checkConnection(port: number): Promise<SuperhumanConnection | null> {
  try {
    const conn = await connectToSuperhuman(port, true); // auto-launch enabled
    if (!conn) {
      error("Could not connect to Superhuman");
      info("Superhuman may not be installed or failed to launch");
      return null;
    }
    return conn;
  } catch (e) {
    error(`Connection failed: ${(e as Error).message}`);
    info(`Superhuman may not be installed at ${getSuperhumanCommand()}`);
    return null;
  }
}

async function cmdStatus(options: CliOptions) {
  info(`Checking connection to Superhuman on port ${options.port}...`);

  const conn = await checkConnection(options.port);
  if (!conn) {
    process.exit(1);
  }

  success("Connected to Superhuman");

  await disconnect(conn);
}

async function cmdDoctor(options: CliOptions) {
  const { collectDoctorReport, formatDoctorReport, fixPort, patchShortcuts } = await import("./doctor");

  if (options.fixPort) {
    info(`Restarting Superhuman gracefully with --remote-debugging-port=${options.port}...`);
    const result = await fixPort(options.port);
    if (result.ok) {
      success(result.message);
    } else {
      error(result.message);
      process.exit(1);
    }
    return;
  }

  if (options.patchShortcut) {
    const result = await patchShortcuts(options.port);
    for (const message of result.messages) {
      info(message);
    }
    if (result.patched.length > 0) {
      success(`Patched ${result.patched.length} shortcut(s)`);
    }
    return;
  }

  info(`Running diagnostics (port ${options.port})...`);
  const report = await collectDoctorReport(options.port);
  console.log(formatDoctorReport(report));
}

async function cmdLaunch(options: CliOptions) {
  info(`Ensuring Superhuman is running with CDP on port ${options.port}...`);
  const ok = await ensureSuperhuman(options.port);
  if (ok) {
    success("Superhuman is running with the debug port");
  } else {
    error("Failed to launch Superhuman");
    info(`Try launching manually: ${getSuperhumanCommand()} --remote-debugging-port=${options.port}`);
    process.exit(1);
  }
}

async function cmdLogs(options: CliOptions) {
  const logPath = `${getConfigDir()}/superhuman.log`;
  const file = Bun.file(logPath);

  if (!(await file.exists())) {
    error(`Log file not found: ${logPath}`);
    info("File logging is written by the MCP server (bun run src/index.ts --mcp).");
    process.exit(1);
  }

  // Print the last N lines
  const text = await file.text();
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop(); // trailing newline
  const count = options.lines > 0 ? options.lines : 50;
  for (const line of lines.slice(-count)) {
    log(line);
  }

  if (!options.follow) return;

  info(`Following ${logPath} (Ctrl+C to stop)...`);
  let offset = (await stat(logPath)).size;
  while (true) {
    await Bun.sleep(1000);
    let size: number;
    try {
      size = (await stat(logPath)).size;
    } catch {
      continue; // file temporarily missing (e.g. mid-rotation)
    }
    if (size < offset) {
      // File was rotated/truncated — start over from the beginning
      offset = 0;
    }
    if (size > offset) {
      const chunk = await Bun.file(logPath).slice(offset, size).text();
      process.stdout.write(chunk);
      offset = size;
    }
  }
}

async function cmdAuth(options: CliOptions) {
  log("Connecting to Superhuman...");
  const conn = await checkConnection(options.port);

  if (conn) {
    try {
      const accounts = await listAccounts(conn);

      if (accounts.length > 0) {
        // Electron app path
        log(`Found ${accounts.length} account(s) (Electron app)`);
        for (const account of accounts) {
          log(`Extracting token for ${account.email}...`);
          await getToken(conn, account.email);
        }
        await saveTokensToDisk();
        success(`Tokens saved to ${getTokensFilePath()}`);
        log("");
        info("You can now use superhuman-cli without Superhuman running.");
        info("Tokens are valid for ~1 hour. Run 'superhuman account auth' again to refresh.");
        return;
      }
      // 0 accounts from Electron path — try Chrome extension
      await disconnect(conn);
    } catch (error) {
      _cliLog.warn("Auth token extraction failed:", error instanceof Error ? error.message : String(error));
      await disconnect(conn);
    }
  }

  // Chrome extension path
  log("Trying Chrome extension path...");
  const chromeConn = await connectToSuperhumanChrome(options.port);
  if (!chromeConn) {
    error("Cannot connect to Superhuman. Make sure it is running with CDP enabled.");
    log(`  Chrome: launch with --remote-debugging-port=${options.port}`);
    log(`  Electron: ${getSuperhumanCommand()} --remote-debugging-port=${options.port}`);
    process.exit(1);
  }

  try {
    const accounts = await listAccountsChrome(chromeConn);
    log(`Found ${accounts.length} account(s) (Chrome extension)`);

    for (const account of accounts) {
      log(`Extracting token for ${account.email}...`);
      try {
        await extractTokenChrome(chromeConn, account.email);
        success(`  ${account.email} OK`);
      } catch (e) {
        error(`  ${account.email} failed: ${(e as Error).message}`);
      }
    }

    await saveTokensToDisk();
    success(`Tokens saved to ${getTokensFilePath()}`);
    log("");
    info("You can now use superhuman-cli without Superhuman running.");
    info("Tokens are valid for ~1 hour. Run 'superhuman account auth' again to refresh.");
  } finally {
    await disconnectChrome(chromeConn);
  }
}

async function cmdAccounts(options: CliOptions) {
  const conn = await checkConnection(options.port);
  if (!conn) {
    process.exit(1);
  }

  const accounts = await listAccounts(conn);

  if (options.json) {
    console.log(formatAccountsJson(accounts));
  } else {
    if (accounts.length === 0) {
      info("No linked accounts found");
    } else {
      console.log(formatAccountsList(accounts));
    }
  }

  await disconnect(conn);
}

async function main() {
  const args = process.argv.slice(2);

  // Handle --version / -v early before parsing
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`superhuman-cli ${VERSION}`);
    process.exit(0);
  }

  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const options = parseArgs(args);

  switch (options.command) {
    case "help":
    case "":
      printHelp();
      break;

    case "status":
      await cmdStatus(options);
      break;

    case "doctor":
      await cmdDoctor(options);
      break;

    case "launch":
      await cmdLaunch(options);
      break;

    case "logs":
      await cmdLogs(options);
      break;

    case "kill": {
      const reason = options.killReason || undefined;
      killActivate(reason);
      const msg = reason ? `Kill switch activated: ${reason}` : "Kill switch activated";
      success(msg);
      break;
    }

    case "unkill": {
      const status = isKilled();
      if (!status.killed) {
        info("Kill switch is not active");
      } else {
        killDeactivate();
        success("Kill switch deactivated — mutations resumed");
      }
      break;
    }

    // account list|auth
    case "account":
      switch (options.subcommand) {
        case "list":
          await cmdAccounts(options);
          break;
        case "auth":
          await cmdAuth(options);
          break;
        default:
          error(`Unknown subcommand: account ${options.subcommand || "(none)"}`);
          log(`Usage: superhuman account list|auth`);
          process.exit(1);
      }
      break;

    default:
      error(`Unknown command: ${options.command}`);
      printHelp();
      process.exit(1);
  }
}

// Only run main when executed directly (not when imported for testing)
if (import.meta.main) {
  main().catch((e) => {
    error(`Fatal error: ${e.message}`);
    process.exit(1);
  });
}
