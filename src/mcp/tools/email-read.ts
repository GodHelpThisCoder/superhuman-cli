/**
 * MCP tool handlers for reading emails: search, inbox, read.
 */

import { z } from "zod";
import { listInbox, searchInbox, type SearchOptions, type ListInboxOptions } from "../../inbox";
import { readThread } from "../../read";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, type ToolResult } from "./shared";

/** Format a contact for display. */
function fmtContact(c: { email: string; name: string }): string {
  return c.name ? `${c.name} <${c.email}>` : c.email;
}

/** Format an array of contacts for display. */
function fmtContacts(contacts: Array<{ email: string; name: string }>): string {
  return contacts.map(fmtContact).join(", ");
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const SearchSchema = z.object({
  query: z.string().describe("Search query string"),
  limit: z.number().optional().describe("Maximum number of results to return (default: 10)"),
});

export const InboxSchema = z.object({
  limit: z.number().optional().describe("Maximum number of threads to return (default: 10)"),
});

export const ReadSchema = z.object({
  threadId: z.string().describe("The thread ID to read"),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function searchHandler(args: z.infer<typeof SearchSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const limit = args.limit ?? 10;

    const options: SearchOptions = { query: args.query, limit };
    const results = await searchInbox(provider, options);

    if (results.length === 0) {
      return successResult(`No results found for: ${args.query}`);
    }

    const resultsText = results
      .map(
        (r, i) =>
          `${i + 1}. From: ${fmtContact(r.from)}\n   Subject: ${r.subject}\n   Date: ${r.date}\n   Thread ID: ${r.id}\n   Snippet: ${r.snippet || "(no preview)"}`
      )
      .join("\n\n");

    return successResult(`Search results for "${args.query}" (${results.length}):\n\n${resultsText}`);
  } catch (error) {
    return actionableError("Search failed", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function inboxHandler(args: z.infer<typeof InboxSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const limit = args.limit ?? 10;

    const results = await listInbox(provider, { limit });

    if (results.length === 0) {
      return successResult("Inbox is empty");
    }

    const resultsText = results
      .map(
        (r, i) =>
          `${i + 1}. From: ${fmtContact(r.from)}\n   Subject: ${r.subject}\n   Date: ${r.date}\n   Thread ID: ${r.id}\n   Snippet: ${r.snippet || "(no preview)"}`
      )
      .join("\n\n");

    return successResult(`Inbox (${results.length} threads):\n\n${resultsText}`);
  } catch (error) {
    return actionableError("Failed to list inbox", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function readHandler(args: z.infer<typeof ReadSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const messages = await readThread(provider, args.threadId);

    if (messages.length === 0) {
      return errorResult(`Thread ${args.threadId} not found or has no messages`);
    }

    const messagesText = messages
      .map(
        (m) =>
          `From: ${fmtContact(m.from)}\nTo: ${fmtContacts(m.to)}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.snippet}`
      )
      .join("\n\n");

    return successResult(`Thread: ${messages[0]!.subject}\n\n${messagesText}`);
  } catch (error) {
    return actionableError("Failed to read thread", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}
