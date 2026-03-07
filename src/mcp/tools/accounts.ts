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
import { successResult, errorResult, actionableError, CDP_PORT, type ToolResult } from "./shared";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const AccountsSchema = z.object({});

export const SwitchAccountSchema = z.object({
  account: z.string().describe("Account to switch to: either an email address or 1-based index number"),
});

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
  let conn: SuperhumanConnection | null = null;

  try {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error("Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    }

    const accounts = await listAccounts(conn);

    if (accounts.length === 0) {
      return errorResult("No linked accounts found");
    }

    let targetEmail: string | undefined;
    const indexMatch = args.account.match(/^(\d+)$/);

    if (indexMatch) {
      const index = parseInt(indexMatch[1]!, 10);
      if (index < 1 || index > accounts.length) {
        return errorResult(`Account index ${index} not found. Valid range: 1-${accounts.length}`);
      }
      targetEmail = accounts[index - 1]!.email;
    } else {
      const account = accounts.find((a) => a.email === args.account);
      if (!account) {
        return errorResult(`Account "${args.account}" not found`);
      }
      targetEmail = account.email;
    }

    const result = await switchAccount(conn, targetEmail);

    if (result.success) {
      return successResult(`Switched to ${result.email}`);
    } else {
      return errorResult(`Failed to switch to ${targetEmail}. Current account: ${result.email}`);
    }
  } catch (error) {
    return actionableError("Failed to switch account", error);
  } finally {
    if (conn) await disconnect(conn);
  }
}
