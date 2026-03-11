/**
 * MCP tool handler for Superhuman AI queries.
 */

import { z } from "zod";
import { askAISearch } from "../../token-api";
import { successResult, errorResult, actionableError, resolveSuperhumanToken, guardMutation, auditMutation, type ToolResult } from "./shared";
import { isConfirmedExecution, stageOperation, buildStagedResponse } from "../confirmation";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const AskAISchema = z.object({
  query: z.string().describe("Natural language query — search emails, ask questions, compose drafts, etc."),
  thread_id: z.string().optional().describe("Optional thread ID to ask about a specific email thread"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function askAIHandler(args: z.infer<typeof AskAISchema>): Promise<ToolResult> {
  if (args.dryRun) {
    return successResult(`[DRY RUN] Would invoke Superhuman AI with query: "${args.query}"`);
  }

  const killed = guardMutation("superhuman_ask_ai", args as Record<string, unknown>);
  if (killed) return killed;

  try {
    const token = await resolveSuperhumanToken();
    if (!token || !token.idToken) {
      return errorResult("No Superhuman credentials found. Run 'superhuman account auth' first.");
    }

    const account = token.email || "unknown";

    // Two-phase: stage unless this is a confirmed execution
    if (!isConfirmedExecution()) {
      const preview = `Would invoke Superhuman AI with query: "${args.query}"${args.thread_id ? ` (thread: ${args.thread_id})` : ""}\nWARNING: Superhuman AI has skills: draft, filter, schedule, multiMessage. This query may trigger real email actions.`;
      const stageToken = stageOperation("superhuman_ask_ai", args as Record<string, unknown>, preview, account);
      auditMutation("superhuman_ask_ai", args as Record<string, unknown>, account, successResult(preview), { action: "staged" });
      return successResult(buildStagedResponse(preview, stageToken));
    }

    const result = await askAISearch(
      token.idToken,
      token,
      args.query,
      { threadId: args.thread_id },
    );

    const toolResult = successResult(result.response);
    auditMutation("superhuman_ask_ai", args as Record<string, unknown>, account, toolResult);
    return toolResult;
  } catch (error) {
    const toolResult = actionableError("AI query failed", error);
    auditMutation("superhuman_ask_ai", args as Record<string, unknown>, "unknown", toolResult);
    return toolResult;
  }
}
