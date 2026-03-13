/**
 * MCP tool handler for Superhuman AI queries.
 */

import { z } from "zod";
import { askAISearch } from "../../token-api";
import { successResult, errorResult, actionableError, resolveSuperhumanToken, getMcpProvider, guardMutation, auditMutation, auditDryRun, type ToolResult } from "./shared";
import { isConfirmedExecution, stageOperation, buildStagedResponse } from "../confirmation";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const AskAISchema = z.object({
  query: z.string().describe("Natural language query — search emails, ask questions, compose drafts, etc."),
  thread_id: z.string().optional().describe("Optional thread ID to ask about a specific email thread"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function askAIHandler(args: z.infer<typeof AskAISchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_ask_ai", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would invoke Superhuman AI with query: "${args.query}"`);
  }

  const killed = guardMutation("superhuman_ask_ai", args as Record<string, unknown>);
  if (killed) return killed;

  try {
    // Try CDP provider first (extracts idToken from running Superhuman), fall back to cached tokens
    let token = await resolveSuperhumanToken();
    if (!token?.idToken) {
      try {
        const provider = await getMcpProvider();
        token = await provider.getToken();
      } catch {
        // Fall through
      }
    }
    if (!token?.idToken) {
      return errorResult(
        "No Superhuman backend credentials found. Ensure Superhuman is running " +
        "and authenticated, or run 'superhuman account auth' to cache credentials."
      );
    }

    const account = token.email || "unknown";

    // Two-phase: stage unless this is a confirmed execution
    if (!isConfirmedExecution()) {
      const preview = `Would invoke Superhuman AI with query: "${args.query}"${args.thread_id ? ` (thread: ${args.thread_id})` : ""}\nWARNING: Superhuman AI has skills: draft, filter, schedule, multiMessage. This query may trigger real email actions.`;
      const stageToken = stageOperation("superhuman_ask_ai", args as Record<string, unknown>, preview, account);
      auditMutation("superhuman_ask_ai", args as Record<string, unknown>, account, successResult(preview), { action: "staged", durationMs: Math.round(performance.now() - _t0) });
      return successResult(buildStagedResponse(preview, stageToken));
    }

    const result = await askAISearch(
      token.idToken,
      token,
      args.query,
      { threadId: args.thread_id },
    );

    const toolResult = successResult(result.response);
    auditMutation("superhuman_ask_ai", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } catch (error) {
    const toolResult = actionableError("AI query failed", error);
    auditMutation("superhuman_ask_ai", args as Record<string, unknown>, "unknown", toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  }
}
