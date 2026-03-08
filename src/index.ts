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

const CDP_PORT = parseInt(process.env.CDP_PORT || "9333", 10);
const HEALTH_CHECK_INTERVAL_MS = 30_000;

const args = process.argv.slice(2);
const isMcpMode = args.includes("--mcp");

if (isMcpMode) {
  // MCP server mode — linked lifecycle with Superhuman
  (async () => {
    // Ensure Superhuman is running before we start accepting tool calls
    const launched = await ensureSuperhuman(CDP_PORT);
    if (!launched) {
      console.error("[launcher] Warning: Superhuman not available at startup. Tools will attempt auto-launch on first call.");
    } else {
      console.error("[launcher] Superhuman is running on CDP port " + CDP_PORT);
    }

    // Start MCP server (blocks on stdio transport)
    const serverPromise = runMcpServer();

    // Health monitor — check Superhuman every 30s, relaunch if down
    const healthInterval = setInterval(async () => {
      try {
        if (!(await isSuperhumanRunning(CDP_PORT))) {
          console.error("[launcher] Superhuman not detected, attempting relaunch...");
          const ok = await ensureSuperhuman(CDP_PORT);
          if (ok) {
            console.error("[launcher] Superhuman relaunched successfully");
          } else {
            console.error("[launcher] Failed to relaunch Superhuman — tools may fail until it's running");
          }
        }
      } catch (e) {
        console.error("[launcher] Health check error:", (e as Error).message);
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
  })().catch(console.error);
} else {
  // CLI mode - import and run the CLI
  import("./cli").then((cli) => {
    // cli.ts handles everything via its main() function
  });
}
