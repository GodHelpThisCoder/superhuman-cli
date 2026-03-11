/**
 * MCP tool handler for confirming staged two-phase operations.
 */

import { z } from "zod";
import {
  confirmOperation,
  withConfirmation,
} from "../confirmation";
import { getMcpProvider, successResult, errorResult, actionableError, resolveSuperhumanToken, guardMutation, auditMutation, type ToolResult } from "./shared";
import { logAudit } from "../../audit";

// Handler imports for dispatch
import { sendHandler } from "./email-write";
import { replyHandler } from "./email-write";
import { replyAllHandler } from "./email-write";
import { forwardHandler } from "./email-write";
import { archiveHandler, deleteHandler } from "./email-manage";
import { calendarCreateHandler, calendarUpdateHandler, calendarDeleteHandler } from "./calendar";
import { switchAccountHandler } from "./accounts";
import { useSnippetHandler } from "./snippets";
import { askAIHandler } from "./ai";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const ConfirmSchema = z.object({
  token: z.string().describe("Confirmation token from a staged operation"),
  force: z.boolean().optional().describe("Required for batch operations exceeding 50 items"),
});

// ---------------------------------------------------------------------------
// Handler dispatch map
// ---------------------------------------------------------------------------

type HandlerFn = (args: Record<string, unknown>) => Promise<ToolResult>;

const HANDLER_MAP: Record<string, HandlerFn> = {
  superhuman_send: sendHandler as HandlerFn,
  superhuman_reply: replyHandler as HandlerFn,
  superhuman_reply_all: replyAllHandler as HandlerFn,
  superhuman_forward: forwardHandler as HandlerFn,
  superhuman_delete: deleteHandler as HandlerFn,
  superhuman_archive: archiveHandler as HandlerFn,
  superhuman_calendar_create: calendarCreateHandler as HandlerFn,
  superhuman_calendar_update: calendarUpdateHandler as HandlerFn,
  superhuman_calendar_delete: calendarDeleteHandler as HandlerFn,
  superhuman_switch_account: switchAccountHandler as HandlerFn,
  superhuman_snippet: useSnippetHandler as HandlerFn,
  superhuman_ask_ai: askAIHandler as HandlerFn,
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function confirmHandler(args: z.infer<typeof ConfirmSchema>): Promise<ToolResult> {
  const killed = guardMutation("superhuman_confirm", args as Record<string, unknown>);
  if (killed) return killed;

  try {
    // Resolve current account for binding check
    let currentAccount = "unknown";
    try {
      const token = await resolveSuperhumanToken();
      if (token?.email) {
        currentAccount = token.email;
      }
    } catch {
      // Fall through to CDP lookup below.
    }

    if (currentAccount === "unknown") {
      try {
        const provider = await getMcpProvider();
        currentAccount = await provider.getCurrentEmail();
      } catch {
        // Keep "unknown" — confirmOperation will reject unknown account bindings.
      }
    }

    // Validate and consume the token
    const op = confirmOperation(args.token, currentAccount, args.force);

    // Look up the handler
    const handler = HANDLER_MAP[op.tool];
    if (!handler) {
      logAudit({
        tool: "superhuman_confirm",
        account: currentAccount,
        action: "rejected",
        args: args as Record<string, unknown>,
        result: "error",
        error: `Unknown tool: ${op.tool}`,
        token: args.token,
        dryRun: false,
      }).catch(() => {});
      return errorResult(`Unknown tool in staged operation: ${op.tool}`);
    }

    // Execute the original handler in confirmed mode
    const result = await withConfirmation(args.token, () => handler(op.args));

    // Audit the confirmation
    auditMutation(
      "superhuman_confirm",
      { token: args.token, tool: op.tool, force: args.force },
      currentAccount,
      result,
      { action: "confirmed" },
    );

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    logAudit({
      tool: "superhuman_confirm",
      account: "unknown",
      action: "rejected",
      args: args as Record<string, unknown>,
      result: "error",
      error: msg,
      token: args.token,
      dryRun: false,
    }).catch(() => {});

    // Return user-friendly error messages
    if (msg.includes("expired") || msg.includes("Invalid")) {
      return errorResult(msg);
    }
    if (msg.includes("Account mismatch")) {
      return errorResult(msg);
    }
    if (msg.includes("Batch exceeds")) {
      return errorResult(msg);
    }

    return actionableError("Confirmation failed", error);
  }
}
