#!/usr/bin/env bun

/**
 * superhuman-cli entry point
 *
 * CLI + MCP server to control Superhuman.app via Chrome DevTools Protocol (CDP)
 *
 * In MCP mode (--mcp):
 * - Connects the stdio transport IMMEDIATELY (the MCP handshake never waits on
 *   Superhuman — launching can take 30-120s during app updates, and a blocked
 *   handshake makes the client time out and respawn the server in a loop)
 * - Starts a LifecycleManager: leader-elected across concurrent server
 *   instances, the leader warm-launches Superhuman in the background and
 *   health-monitors it; followers never launch/kill the app
 * - Exits when the client disconnects (stdin EOF) so dead sessions never
 *   leave orphaned server processes behind
 *
 * Usage:
 *   superhuman status
 *   superhuman doctor
 *   superhuman --mcp        # Run as MCP server
 */

import { runMcpServer } from "./mcp/server";
import { flushAuditLog } from "./audit";
import { setLogLevel, initFileLogging, createLogger } from "./logger";
import { LifecycleManager, setLifecycleManager } from "./lifecycle/manager";
import { setLaunchBroker } from "./cdp/connection";
import { APP_VERSION } from "./version";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9333", 10);

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

  (async () => {
    await initFileLogging();

    // Version log — verifiable proof that this code is running (not a stale process)
    log.info(`superhuman-cli v${APP_VERSION} MCP server starting`);

    // 1. Connect the stdio transport FIRST — the handshake must be instant.
    //    Superhuman availability is handled lazily by the lifecycle manager
    //    and surfaced through tool errors, never through a stalled handshake.
    await runMcpServer();

    // 2. Lifecycle management: leader election + background warm launch +
    //    health monitoring. Not awaited — tools gate on it via ensureReady().
    const manager = new LifecycleManager(CDP_PORT);
    setLifecycleManager(manager);
    setLaunchBroker(manager);
    manager.start();

    // 3. Shutdown wiring. stdin EOF/close means the MCP client is gone —
    //    exit instead of lingering as an orphan (manager timers are also
    //    unref()ed as a second line of defense).
    const shutdown = (reason: string) => {
      log.info(`Shutting down (${reason})`);
      manager.stop();
      // Drain any in-flight audit write (bounded) — an executed mutation must
      // not lose its audit record to a racing exit.
      void Promise.race([
        flushAuditLog(),
        new Promise((r) => setTimeout(r, 500)),
      ]).finally(() => process.exit(0));
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.stdin.on("end", () => shutdown("stdin EOF"));
    process.stdin.on("close", () => shutdown("stdin closed"));
  })().catch((e) => {
    log.error("Fatal:", e instanceof Error ? e.message : String(e));
    // A failed startup must not linger as a half-initialized process with no
    // transport and no shutdown wiring — exit so the client can respawn.
    process.exit(1);
  });
} else {
  // CLI mode - import and run the CLI
  import("./cli").then((cli) => {
    // cli.ts handles everything via its main() function
  });
}
