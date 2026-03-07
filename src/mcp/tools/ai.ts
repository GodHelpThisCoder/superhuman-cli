/**
 * MCP tool handler for Superhuman AI queries.
 */

import { z } from "zod";
import { askAISearch } from "../../token-api";
import { successResult, errorResult, actionableError, resolveSuperhumanToken, type ToolResult } from "./shared";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const AskAISchema = {
  query: z.string().describe("Natural language query — search emails, ask questions, compose drafts, etc."),
  thread_id: z.string().optional().describe("Optional thread ID to ask about a specific email thread"),
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function askAIHandler(args: z.infer<z.ZodObject<typeof AskAISchema>>): Promise<ToolResult> {
  try {
    const token = await resolveSuperhumanToken();
    if (!token || !token.idToken) {
      return errorResult("No Superhuman credentials found. Run 'superhuman account auth' first.");
    }

    const result = await askAISearch(
      token.idToken,
      token,
      args.query,
      { threadId: args.thread_id },
    );

    return successResult(result.response);
  } catch (error) {
    return actionableError("AI query failed", error);
  }
}
