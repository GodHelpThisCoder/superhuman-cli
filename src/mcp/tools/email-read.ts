/**
 * MCP tool handlers for reading emails: search, inbox, read.
 */

import { z } from "zod";
import { listInbox, searchInbox, type SearchOptions, type ListInboxOptions } from "../../inbox";
import { readThread } from "../../read";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, type ToolResult } from "./shared";
import { paginateSearchAll } from "./email-manage";

/** Format a contact for display. */
function fmtContact(c: { email: string; name: string }): string {
  return c.name ? `${c.name} <${c.email}>` : c.email;
}

/** Format an array of contacts for display. */
function fmtContacts(contacts: Array<{ email: string; name: string }>): string {
  return contacts.map(fmtContact).join(", ");
}

/** Format thread metadata line (messageCount, labels, unread). */
function fmtMeta(r: { messageCount: number; labelIds: string[] }): string {
  const parts: string[] = [];
  if (r.messageCount > 1) parts.push(`${r.messageCount} messages`);
  if (r.labelIds.includes("UNREAD")) parts.push("unread");
  const labels = r.labelIds.filter((l) => l !== "UNREAD" && l !== "INBOX" && l !== "IMPORTANT");
  if (labels.length > 0) parts.push(`labels: ${labels.join(", ")}`);
  return parts.length > 0 ? `\n   Meta: ${parts.join(" | ")}` : "";
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const SearchSchema = z.object({
  query: z.string().describe("Search query string"),
  limit: z.number().int().min(1).max(50).optional().describe("Maximum number of results to return (1-50). Default: 10."),
  includeDone: z.boolean().optional().describe("Search all mail including archived/done threads. Default: false (inbox only)."),
  pageToken: z.string().optional().describe("Gmail pagination token from a previous search's nextPageToken. Pass this to get the next page of results."),
}).strict();

export const InboxSchema = z.object({
  limit: z.number().optional().describe("Maximum number of threads to return (default: 10)"),
}).strict();

export const ReadSchema = z.object({
  threadId: z.string().describe("The thread ID to read"),
}).strict();

export const SenderSummarySchema = z.object({
  query: z.string().describe("Search query to scan (e.g. 'in:inbox before:2024/01/01')"),
  limit: z.number().int().min(1).max(500).optional().describe("Max threads to scan internally (1-500, default 500)"),
  includeDone: z.boolean().optional().describe("Search all mail including archived/done threads. Default: false (inbox only)."),
}).strict();

export const CollectThreadIdsSchema = z.object({
  query: z.string().describe("Search query to collect thread IDs for"),
  limit: z.number().int().min(1).max(500).optional().describe("Max threads to collect (1-500, default 500)"),
  includeDone: z.boolean().optional().describe("Search all mail including archived/done threads. Default: false (inbox only)."),
}).strict();

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function searchHandler(args: z.infer<typeof SearchSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const limit = args.limit ?? 10;

    const options: SearchOptions = { query: args.query, limit, includeDone: args.includeDone ?? false, pageToken: args.pageToken };
    const { threads, totalResults, nextPageToken } = await searchInbox(provider, options);

    if (threads.length === 0) {
      return successResult(`No results found for: ${args.query}`);
    }

    const resultsText = threads
      .map(
        (r, i) =>
          `${i + 1}. From: ${fmtContact(r.from)}\n   Subject: ${r.subject}\n   Date: ${r.date}\n   Thread ID: ${r.id}\n   Snippet: ${r.snippet || "(no preview)"}${fmtMeta(r)}`
      )
      .join("\n\n");

    const totalStr = totalResults != null ? ` (~${totalResults} total)` : "";
    const pageStr = nextPageToken ? `\n\nnextPageToken: ${nextPageToken}` : "";
    return successResult(`Search results for "${args.query}" (${threads.length} returned${totalStr}):\n\n${resultsText}${pageStr}`);
  } catch (error) {
    return actionableError("Search failed", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
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
          `${i + 1}. From: ${fmtContact(r.from)}\n   Subject: ${r.subject}\n   Date: ${r.date}\n   Thread ID: ${r.id}\n   Snippet: ${r.snippet || "(no preview)"}${fmtMeta(r)}`
      )
      .join("\n\n");

    return successResult(`Inbox (${results.length} threads):\n\n${resultsText}`);
  } catch (error) {
    return actionableError("Failed to list inbox", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
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
          `From: ${fmtContact(m.from)}\nTo: ${fmtContacts(m.to)}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body || m.snippet}`
      )
      .join("\n\n");

    return successResult(`Thread: ${messages[0]!.subject}\n\n${messagesText}`);
  } catch (error) {
    return actionableError("Failed to read thread", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function senderSummaryHandler(args: z.infer<typeof SenderSummarySchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const maxThreads = args.limit ?? 500;
    const includeDone = args.includeDone ?? false;
    const threads = await paginateSearchAll(provider, args.query, maxThreads, includeDone);

    if (threads.length === 0) {
      return successResult(`No threads found for query: ${args.query}`);
    }

    // Get totalResults estimate from a quick search
    const { totalResults } = await searchInbox(provider, { query: args.query, limit: 1, includeDone });

    // Group by sender email
    const groups = new Map<string, { count: number; sampleSubject: string; oldestDate: string; newestDate: string }>();
    for (const thread of threads) {
      const rawSender = thread.from.email || thread.from.name || "(unknown)";
      // If sender looks invalid (1-2 chars or missing @), build a fallback from available fields
      const sender = (rawSender.length <= 2 || (!rawSender.includes("@") && rawSender !== "(unknown)"))
        ? (thread.from.name && thread.from.name.length > 2
            ? `${thread.from.name}${thread.from.email ? ` <${thread.from.email}>` : ""}`
            : thread.from.email || thread.from.name || "(unknown)")
        : rawSender;
      const existing = groups.get(sender);
      if (existing) {
        existing.count++;
        const threadTime = new Date(thread.date).getTime();
        if (threadTime < new Date(existing.oldestDate).getTime()) existing.oldestDate = thread.date;
        if (threadTime > new Date(existing.newestDate).getTime()) existing.newestDate = thread.date;
      } else {
        groups.set(sender, {
          count: 1,
          sampleSubject: thread.subject,
          oldestDate: thread.date,
          newestDate: thread.date,
        });
      }
    }

    // Sort by count descending
    const sorted = Array.from(groups.entries())
      .map(([sender, data]) => ({ sender, ...data }))
      .sort((a, b) => b.count - a.count);

    const totalGroups = sorted.length;
    const truncated = totalGroups > 50;
    const capped = sorted.slice(0, 50);

    // Format dates to YYYY-MM-DD for readability
    const fmtDate = (d: string) => {
      try { return new Date(d).toISOString().split("T")[0]; } catch { return d; }
    };

    const result = {
      groups: capped.map((g) => ({
        sender: g.sender,
        count: g.count,
        sampleSubject: g.sampleSubject,
        oldestDate: fmtDate(g.oldestDate),
        newestDate: fmtDate(g.newestDate),
      })),
      totalGroups,
      truncated,
      totalResults: totalResults ?? null,
      threadsScanned: threads.length,
    };

    return successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return actionableError("Sender summary failed", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function collectThreadIdsHandler(args: z.infer<typeof CollectThreadIdsSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const maxThreads = args.limit ?? 500;
    const includeDone = args.includeDone ?? false;
    const threads = await paginateSearchAll(provider, args.query, maxThreads, includeDone);

    // Get totalResults estimate from a quick search
    const { totalResults } = await searchInbox(provider, { query: args.query, limit: 1, includeDone });

    const threadIds = threads.map((t) => t.id);
    const totalCollected = threadIds.length;
    const estimatedTotal = totalResults ?? totalCollected;
    const truncated = estimatedTotal > totalCollected;

    const result = {
      threadIds,
      totalCollected,
      truncated,
      totalResults: totalResults ?? null,
    };

    return successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return actionableError("Collect thread IDs failed", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}
