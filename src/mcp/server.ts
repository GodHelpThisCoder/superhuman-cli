/**
 * MCP Server for Superhuman CLI
 *
 * Exposes Superhuman automation functions as MCP tools using the
 * @modelcontextprotocol/sdk package.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mcpTools, DraftSchema, SendSchema, SearchSchema, draftHandler, sendHandler, searchHandler } from "./tools";

/**
 * Create and configure the MCP server
 */
function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "superhuman-cli",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register superhuman_draft tool
  server.registerTool(
    "superhuman_draft",
    {
      description:
        "Create an email draft in Superhuman. Opens the compose window, fills in the fields, and saves as draft.",
      inputSchema: DraftSchema,
    },
    async (args) => {
      const result = await draftHandler(args);
      return result;
    }
  );

  // Register superhuman_send tool
  server.registerTool(
    "superhuman_send",
    {
      description:
        "Send an email via Superhuman. Opens the compose window, fills in the fields, and sends the email.",
      inputSchema: SendSchema,
    },
    async (args) => {
      const result = await sendHandler(args);
      return result;
    }
  );

  // Register superhuman_search tool
  server.registerTool(
    "superhuman_search",
    {
      description:
        "Search the Superhuman inbox. Returns a list of emails matching the search query.",
      inputSchema: SearchSchema,
    },
    async (args) => {
      const result = await searchHandler(args);
      return result;
    }
  );

  return server;
}

/**
 * Run the MCP server using stdio transport
 *
 * This function starts the MCP server and connects it to stdin/stdout
 * for communication with the MCP client.
 */
export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Keep the server running
  // The server will handle incoming requests via stdio
  // and respond accordingly
}

export { createMcpServer };
