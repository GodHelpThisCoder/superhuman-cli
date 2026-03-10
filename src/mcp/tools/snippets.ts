/**
 * MCP tool handlers for snippets: list and use.
 */

import { z } from "zod";
import { listSnippets, findSnippet, applyVars, parseVars } from "../../snippets";
import { getUserInfo, getUserInfoFromCache, createDraftWithUserInfo, sendDraftSuperhuman } from "../../draft-api";
import {
  connectToSuperhuman,
  disconnect,
} from "../../superhuman-api";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, guardMutation, auditMutation, CDP_PORT, type ToolResult } from "./shared";
import { isConfirmedExecution, stageOperation, buildStagedResponse } from "../confirmation";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const SnippetsSchema = z.object({});

export const UseSnippetSchema = z.object({
  name: z.string().describe("Snippet name to search for (fuzzy match)"),
  to: z.string().optional().describe("Recipient email address (overrides snippet default)"),
  cc: z.string().optional().describe("CC recipient email (overrides snippet default)"),
  bcc: z.string().optional().describe("BCC recipient email (overrides snippet default)"),
  vars: z.string().optional().describe("Template variables as 'key1=val1,key2=val2'"),
  send: z.boolean().optional().describe("Send immediately instead of creating draft (default: false)"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Get UserInfo from a ConnectionProvider (prefers cached tokens, falls back to CDP).
 */
async function getUserInfoFromProvider(provider: ConnectionProvider): Promise<import("../../draft-api").UserInfo> {
  const token = await provider.getToken();
  if (token.userId && token.idToken) {
    return getUserInfoFromCache(token.userId, token.email, token.idToken);
  }
  // Fallback: if token lacks userId/idToken, try CDP
  const conn = await connectToSuperhuman(CDP_PORT);
  if (!conn) {
    throw new Error("Cached token missing userId/idToken. Run 'superhuman account auth' to re-authenticate.");
  }
  try {
    return await getUserInfo(conn);
  } finally {
    await disconnect(conn);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function snippetsHandler(_args: z.infer<typeof SnippetsSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const userInfo = await getUserInfoFromProvider(provider);
    const snippets = await listSnippets(userInfo);

    if (snippets.length === 0) {
      return successResult("No snippets found");
    }

    const snippetsList = snippets
      .map((s) => {
        const lastUsed = s.lastSentAt ? new Date(s.lastSentAt).toLocaleDateString() : "never";
        return `- ${s.name}\n  Sends: ${s.sends} | Last used: ${lastUsed}\n  Subject: ${s.subject || "(none)"}\n  Preview: ${s.snippet || "(empty)"}`;
      })
      .join("\n\n");

    return successResult(`Snippets (${snippets.length}):\n\n${snippetsList}`);
  } catch (error) {
    return actionableError("Failed to list snippets", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function useSnippetHandler(args: z.infer<typeof UseSnippetSchema>): Promise<ToolResult> {
  if (args.dryRun) {
    return successResult(`[DRY RUN] Would ${args.send ? "send" : "draft"} email using snippet "${args.name}"`);
  }

  const killed = guardMutation("superhuman_snippet", args as Record<string, unknown>);
  if (killed) return killed;

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

    // Two-phase: stage when sending (not drafting)
    if (!isConfirmedExecution() && (args.send ?? false)) {
      const preview = `Would send email using snippet "${args.name}" to ${args.to || "default recipient"}`;
      const token = stageOperation("superhuman_snippet", args as Record<string, unknown>, preview, account);
      auditMutation("superhuman_snippet", args as Record<string, unknown>, account, successResult(preview), { action: "staged" });
      return successResult(buildStagedResponse(preview, token));
    }

    const userInfo = await getUserInfoFromProvider(provider);
    const snippets = await listSnippets(userInfo);
    const snippet = findSnippet(snippets, args.name);

    if (!snippet) {
      const available = snippets.map((s) => s.name).join(", ");
      const toolResult = errorResult(`No snippet matching "${args.name}". Available: ${available}`);
      auditMutation("superhuman_snippet", args as Record<string, unknown>, account, toolResult);
      return toolResult;
    }

    // Apply template variables
    const vars = args.vars ? parseVars(args.vars) : {};
    let body = snippet.body;
    let subject = snippet.subject;
    if (Object.keys(vars).length > 0) {
      body = applyVars(body, vars);
      subject = applyVars(subject, vars);
    }

    // Merge recipients
    const to = args.to ? [args.to] : snippet.to;
    const cc = args.cc ? [args.cc] : snippet.cc.length > 0 ? snippet.cc : undefined;
    const bcc = args.bcc ? [args.bcc] : snippet.bcc.length > 0 ? snippet.bcc : undefined;

    if (args.send) {
      if (to.length === 0) {
        const toolResult = errorResult("At least one recipient is required (provide 'to' or snippet must have default recipients)");
        auditMutation("superhuman_snippet", args as Record<string, unknown>, account, toolResult);
        return toolResult;
      }

      const draftResult = await createDraftWithUserInfo(userInfo, { to, cc, bcc, subject, body });
      if (!draftResult.success || !draftResult.draftId || !draftResult.threadId) {
        const toolResult = errorResult(`Failed to create draft: ${draftResult.error}`);
        auditMutation("superhuman_snippet", args as Record<string, unknown>, account, toolResult);
        return toolResult;
      }

      const sendResult = await sendDraftSuperhuman(userInfo, {
        draftId: draftResult.draftId,
        threadId: draftResult.threadId,
        to: to.map((email) => ({ email })),
        cc: cc?.map((email) => ({ email })),
        bcc: bcc?.map((email) => ({ email })),
        subject,
        htmlBody: body,
        delay: 0,
      });

      if (sendResult.success) {
        const toolResult = successResult(`Sent using snippet "${snippet.name}" to ${to.join(", ")}`);
        auditMutation("superhuman_snippet", args as Record<string, unknown>, account, toolResult);
        return toolResult;
      } else {
        const toolResult = errorResult(`Failed to send: ${sendResult.error}`);
        auditMutation("superhuman_snippet", args as Record<string, unknown>, account, toolResult);
        return toolResult;
      }
    } else {
      const result = await createDraftWithUserInfo(userInfo, { to, cc, bcc, subject, body });
      if (result.success) {
        const toolResult = successResult(
          `Draft created from snippet "${snippet.name}"\nDraft ID: ${result.draftId}\nTo: ${to.join(", ")}\nSubject: ${subject || "(none)"}`
        );
        auditMutation("superhuman_snippet", args as Record<string, unknown>, account, toolResult);
        return toolResult;
      } else {
        const toolResult = errorResult(`Failed to create draft: ${result.error}`);
        auditMutation("superhuman_snippet", args as Record<string, unknown>, account, toolResult);
        return toolResult;
      }
    }
  } catch (error) {
    const toolResult = actionableError("Failed to use snippet", error);
    auditMutation("superhuman_snippet", args as Record<string, unknown>, "unknown", toolResult);
    return toolResult;
  } finally {
    if (provider) await provider.disconnect();
  }
}
