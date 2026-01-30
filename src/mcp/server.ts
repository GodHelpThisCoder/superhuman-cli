/**
 * MCP Server for Superhuman CLI
 *
 * Exposes Superhuman automation functions as MCP tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DraftSchema, SendSchema, SearchSchema, draftHandler, sendHandler, searchHandler } from "./tools";

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "superhuman-cli", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "superhuman_draft",
    {
      description: "Create an email draft in Superhuman. Opens the compose window, fills in the fields, and saves as draft.",
      inputSchema: DraftSchema,
    },
    draftHandler
  );

  server.registerTool(
    "superhuman_send",
    {
      description: "Send an email via Superhuman. Opens the compose window, fills in the fields, and sends the email.",
      inputSchema: SendSchema,
    },
    sendHandler
  );

  server.registerTool(
    "superhuman_search",
    {
      description: "Search the Superhuman inbox. Returns a list of emails matching the search query.",
      inputSchema: SearchSchema,
    },
    searchHandler
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { createMcpServer };
