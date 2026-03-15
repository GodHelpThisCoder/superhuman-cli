#!/usr/bin/env bun

/**
 * superhuman-cli entry point
 *
 * CLI + MCP server to control Superhuman.app via Chrome DevTools Protocol (CDP)
 *
 * In MCP mode (--mcp):
 * - Ensures Superhuman is running before accepting tool calls
 * - Monitors Superhuman health every 30s and relaunches if needed
 * - Cleans up on exit
 *
 * Usage:
 *   superhuman compose --to <email> --subject <subject> --body <body>
 *   superhuman draft --to <email> --subject <subject> --body <body>
 *   superhuman send --to <email> --subject <subject> --body <body>
 *   superhuman status
 *   superhuman --mcp        # Run as MCP server (auto-launches Superhuman)
 */

import { runMcpServer } from "./mcp/server";
import { ensureSuperhuman, isSuperhumanRunning } from "./superhuman-api";
import { setLogLevel, initFileLogging, createLogger } from "./logger";
import { isUpdaterRunning } from "./update-awareness";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9333", 10);
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const RELAUNCH_COOLDOWN_MS = 60_000;

const args = process.argv.slice(2);
const isMcpMode = args.includes("--mcp");
const isVerbose = args.includes("--verbose") || process.env.SUPERHUMAN_LOG_LEVEL === "debug";
if (isVerbose) setLogLevel("debug");

const log = createLogger("launcher");

if (isMcpMode) {
  // Prevent unhandled CDP WebSocket errors from crashing the MCP server process
  process.on("unhandledRejection", (err) => {
    log.error("Unhandled rejection (kept alive):", err);
  });

  // MCP server mode — linked lifecycle with Superhuman
  (async () => {
    await initFileLogging();

    // Ensure Superhuman is running before we start accepting tool calls
    const launched = await ensureSuperhuman(CDP_PORT);
    if (!launched) {
      log.warn("Superhuman not available at startup. Tools will attempt auto-launch on first call.");
    } else {
      log.info("Superhuman is running on CDP port " + CDP_PORT);
    }

    // Start MCP server (blocks on stdio transport)
    const serverPromise = runMcpServer();

    // Health monitor — check Superhuman every 30s, relaunch if down
    // Update-aware: skips relaunch if installer is active or cooldown hasn't elapsed
    let lastRelaunchAttemptMs = 0;
    const healthInterval = setInterval(async () => {
      try {
        if (!(await isSuperhumanRunning(CDP_PORT))) {
          // Check relaunch cooldown
          const now = Date.now();
          if (now - lastRelaunchAttemptMs < RELAUNCH_COOLDOWN_MS) {
            log.debug("Relaunch cooldown active, skipping health check relaunch");
            return;
          }

          // Check if updater is running — don't fight the installer
          if (await isUpdaterRunning()) {
            log.info("Skipping relaunch — update installer active");
            return;
          }

          log.warn("Superhuman not detected, attempting relaunch...");
          lastRelaunchAttemptMs = now;
          const ok = await ensureSuperhuman(CDP_PORT);
          if (ok) {
            log.info("Superhuman relaunched successfully");
          } else {
            log.error("Failed to relaunch Superhuman — tools may fail until it's running");
          }
        }
      } catch (e) {
        log.error("Health check error:", (e as Error).message);
      }
    }, HEALTH_CHECK_INTERVAL_MS);

    // Cleanup on exit
    const cleanup = () => {
      clearInterval(healthInterval);
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    await serverPromise;
  })().catch((e) => log.error("Fatal:", e instanceof Error ? e.message : String(e)));
} else {
  // CLI mode - import and run the CLI
  import("./cli").then((cli) => {
    // cli.ts handles everything via its main() function
  });
}
