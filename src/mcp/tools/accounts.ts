/**
 * MCP tool handlers for account management: list accounts, switch account.
 */

import { z } from "zod";
import {
  connectToSuperhuman,
  disconnect,
  type SuperhumanConnection,
} from "../../superhuman-api";
import { listAccounts, switchAccount } from "../../accounts";
import { successResult, errorResult, actionableError, resolveCurrentAccountViaCDP, guardMutation, auditMutation, auditDryRun, warmResolvedEmailCache, CDP_PORT, type ToolResult } from "./shared";
import { isConfirmedExecution, stageOperation, buildStagedResponse } from "../confirmation";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const AccountsSchema = z.object({}).strict();

export const SwitchAccountSchema = z.object({
  account: z.string().describe("Account to switch to: either an email address or 1-based index number"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function accountsHandler(_args: z.infer<typeof AccountsSchema>): Promise<ToolResult> {
  let conn: SuperhumanConnection | null = null;

  try {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error("Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    }

    const accounts = await listAccounts(conn);

    // Warm the resolved-email cache so subsequent parallel tool calls
    // (e.g. 4 concurrent searches) skip CDP resolution entirely
    const current = accounts.find((a) => a.isCurrent);
    if (current) {
      warmResolvedEmailCache(current.email);
    }

    if (accounts.length === 0) {
      return successResult("No linked accounts found");
    }

    const accountsText = accounts
      .map((a, i) => {
        const marker = a.isCurrent ? "* " : "  ";
        const current = a.isCurrent ? " (current)" : "";
        return `${marker}${i + 1}. ${a.email}${current}`;
      })
      .join("\n");

    return successResult(`Linked accounts:\n\n${accountsText}`);
  } catch (error) {
    return actionableError("Failed to list accounts", error);
  } finally {
    if (conn) await disconnect(conn);
  }
}

export async function switchAccountHandler(args: z.infer<typeof SwitchAccountSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_switch_account", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would switch to account ${args.account}`);
  }

  const killed = guardMutation("superhuman_switch_account", args as Record<string, unknown>);
  if (killed) return killed;

  // Two-phase: stage unless this is a confirmed execution
  if (!isConfirmedExecution()) {
    // Resolve *current* account directly from CDP (not cached tokens).
    // CachedTokenProvider.getCurrentEmail() returns the first cached account
    // from disk, which doesn't reflect the actual Superhuman UI state.
    let currentAccount = "unknown";
    try {
      currentAccount = await resolveCurrentAccountViaCDP();
    } catch {
      // Fall through with "unknown"
    }

    const preview = `Would switch to account ${args.account}`;
    const token = stageOperation("superhuman_switch_account", args as Record<string, unknown>, preview, currentAccount);
    auditMutation("superhuman_switch_account", args as Record<string, unknown>, currentAccount, successResult(preview), { action: "staged" });
    return successResult(buildStagedResponse(preview, token));
  }

  const account = args.account;
  let conn: SuperhumanConnection | null = null;

  try {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error("Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    }

    const accounts = await listAccounts(conn);

    if (accounts.length === 0) {
      const toolResult = errorResult("No linked accounts found");
      auditMutation("superhuman_switch_account", args as Record<string, unknown>, account, toolResult);
      return toolResult;
    }

    let targetEmail: string | undefined;
    const indexMatch = args.account.match(/^(\d+)$/);

    if (indexMatch) {
      const index = parseInt(indexMatch[1]!, 10);
      if (index < 1 || index > accounts.length) {
        const toolResult = errorResult(`Account index ${index} not found. Valid range: 1-${accounts.length}`);
        auditMutation("superhuman_switch_account", args as Record<string, unknown>, account, toolResult);
        return toolResult;
      }
      targetEmail = accounts[index - 1]!.email;
    } else {
      const acct = accounts.find((a) => a.email === args.account);
      if (!acct) {
        const toolResult = errorResult(`Account "${args.account}" not found`);
        auditMutation("superhuman_switch_account", args as Record<string, unknown>, account, toolResult);
        return toolResult;
      }
      targetEmail = acct.email;
    }

    const result = await switchAccount(conn, targetEmail);

    if (result.success) {
      const toolResult = successResult(`Switched to ${result.email}`);
      auditMutation("superhuman_switch_account", args as Record<string, unknown>, account, toolResult);
      return toolResult;
    } else {
      const toolResult = errorResult(`Failed to switch to ${targetEmail}. Current account: ${result.email}`);
      auditMutation("superhuman_switch_account", args as Record<string, unknown>, account, toolResult);
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to switch account", error);
    auditMutation("superhuman_switch_account", args as Record<string, unknown>, "unknown", toolResult);
    return toolResult;
  } finally {
    if (conn) await disconnect(conn);
  }
}
