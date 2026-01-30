#!/usr/bin/env bun

/**
 * superhuman-cli entry point
 *
 * CLI + MCP server to control Superhuman.app via Chrome DevTools Protocol (CDP)
 *
 * Usage:
 *   superhuman compose --to <email> --subject <subject> --body <body>
 *   superhuman draft --to <email> --subject <subject> --body <body>
 *   superhuman send --to <email> --subject <subject> --body <body>
 *   superhuman status
 *   superhuman --mcp        # Run as MCP server
 */

import { runMcpServer } from "./mcp/server";

const args = process.argv.slice(2);
const isMcpMode = args.includes("--mcp");

if (isMcpMode) {
  // MCP server mode - run silently (no console output to stdout)
  // All communication happens via stdio JSON-RPC
  runMcpServer().catch(console.error);
} else {
  // CLI mode - import and run the CLI
  import("./cli").then((cli) => {
    // cli.ts handles everything via its main() function
  });
}
