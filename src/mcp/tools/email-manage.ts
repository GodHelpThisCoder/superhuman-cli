/**
 * MCP tool handlers for email management: archive, delete, mark read/unread,
 * star/unstar, snooze/unsnooze.
 */

import { z } from "zod";
import { archiveThread, deleteThread } from "../../archive";
import { markAsRead, markAsUnread } from "../../read-status";
import { starThread, unstarThread, listStarred } from "../../labels";
import { parseSnoozeTime, snoozeThreadViaProvider, unsnoozeThreadViaProvider, listSnoozedViaProvider } from "../../snooze";
import { searchInbox, type InboxThread } from "../../inbox";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, guardMutation, auditMutation, auditDryRun, type ToolResult } from "./shared";
import { isConfirmedExecution, stageOperation, buildStagedResponse, buildBatchPreview, buildManifest } from "../confirmation";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ArchiveSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to archive"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const DeleteSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to delete (move to trash)"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const MarkReadSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to mark as read"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const MarkUnreadSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to mark as unread"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const StarSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to star"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const UnstarSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to unstar"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const StarredSchema = z.object({
  limit: z.number().optional().describe("Maximum number of starred threads to return (default: 50)"),
}).strict();

export const SnoozeSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to snooze"),
  until: z.union([
    z.enum(["tomorrow", "next-week", "weekend", "evening"]),
    z.string().describe("ISO datetime (e.g., 2026-03-10T14:00:00Z)"),
  ]).describe("When to unsnooze: use a preset or provide an ISO datetime"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const UnsnoozeSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to unsnooze"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const SnoozedSchema = z.object({
  limit: z.number().optional().describe("Maximum number of snoozed threads to return (default: 50)"),
}).strict();

export const ArchiveByQuerySchema = z.object({
  query: z.string().describe("Search query whose matching threads will be staged for archive. Run this query through superhuman_search first to verify what it matches."),
  dryRun: z.boolean().optional().describe("Preview what would be archived without staging. Returns matched threads and count."),
}).strict();

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function archiveHandler(args: z.infer<typeof ArchiveSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_archive", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would archive ${args.threadIds.length} thread(s)`);
  }

  const killed = guardMutation("superhuman_archive", args as Record<string, unknown>);
  if (killed) return killed;

  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

    // Two-phase: stage unless this is a confirmed execution
    if (!isConfirmedExecution()) {
      const manifest = await buildManifest(provider, args.threadIds);
      const preview = buildBatchPreview("archive", args.threadIds, manifest);
      const token = stageOperation("superhuman_archive", args as Record<string, unknown>, preview, account);
      auditMutation("superhuman_archive", args as Record<string, unknown>, account, successResult(preview), { action: "staged", batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return successResult(buildStagedResponse(preview, token));
    }

    const results: { threadId: string; success: boolean }[] = [];

    for (const threadId of args.threadIds) {
      const result = await archiveThread(provider, threadId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Archived ${succeeded} thread(s) successfully`);
      auditMutation("superhuman_archive", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to archive all ${failed} thread(s)`);
      auditMutation("superhuman_archive", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Archived ${succeeded} thread(s), failed to archive ${failed}: ${failedIds}`);
      auditMutation("superhuman_archive", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to archive", error);
    auditMutation("superhuman_archive", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function deleteHandler(args: z.infer<typeof DeleteSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_delete", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would delete ${args.threadIds.length} thread(s)`);
  }

  const killed = guardMutation("superhuman_delete", args as Record<string, unknown>);
  if (killed) return killed;

  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

    // Two-phase: stage unless this is a confirmed execution
    if (!isConfirmedExecution()) {
      const manifest = await buildManifest(provider, args.threadIds);
      const preview = buildBatchPreview("delete", args.threadIds, manifest);
      const token = stageOperation("superhuman_delete", args as Record<string, unknown>, preview, account);
      auditMutation("superhuman_delete", args as Record<string, unknown>, account, successResult(preview), { action: "staged", batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return successResult(buildStagedResponse(preview, token));
    }

    const results: { threadId: string; success: boolean }[] = [];

    for (const threadId of args.threadIds) {
      const result = await deleteThread(provider, threadId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Deleted ${succeeded} thread(s) successfully`);
      auditMutation("superhuman_delete", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to delete all ${failed} thread(s)`);
      auditMutation("superhuman_delete", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Deleted ${succeeded} thread(s), failed to delete ${failed}: ${failedIds}`);
      auditMutation("superhuman_delete", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to delete", error);
    auditMutation("superhuman_delete", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function markReadHandler(args: z.infer<typeof MarkReadSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_mark_read", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would mark ${args.threadIds.length} thread(s) as read`);
  }

  const killed = guardMutation("superhuman_mark_read", args as Record<string, unknown>);
  if (killed) return killed;

  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();
    const results: { threadId: string; success: boolean }[] = [];

    for (const threadId of args.threadIds) {
      const result = await markAsRead(provider, threadId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Marked ${succeeded} thread(s) as read`);
      auditMutation("superhuman_mark_read", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to mark all ${failed} thread(s) as read`);
      auditMutation("superhuman_mark_read", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Marked ${succeeded} thread(s) as read, failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_mark_read", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to mark as read", error);
    auditMutation("superhuman_mark_read", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function markUnreadHandler(args: z.infer<typeof MarkUnreadSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_mark_unread", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would mark ${args.threadIds.length} thread(s) as unread`);
  }

  const killed = guardMutation("superhuman_mark_unread", args as Record<string, unknown>);
  if (killed) return killed;

  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();
    const results: { threadId: string; success: boolean }[] = [];

    for (const threadId of args.threadIds) {
      const result = await markAsUnread(provider, threadId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Marked ${succeeded} thread(s) as unread`);
      auditMutation("superhuman_mark_unread", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to mark all ${failed} thread(s) as unread`);
      auditMutation("superhuman_mark_unread", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Marked ${succeeded} thread(s) as unread, failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_mark_unread", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to mark as unread", error);
    auditMutation("superhuman_mark_unread", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function starHandler(args: z.infer<typeof StarSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_star", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would star ${args.threadIds.length} thread(s)`);
  }

  const killed = guardMutation("superhuman_star", args as Record<string, unknown>);
  if (killed) return killed;

  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await starThread(provider, threadId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Starred ${succeeded} thread(s)`);
      auditMutation("superhuman_star", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to star all ${failed} thread(s)`);
      auditMutation("superhuman_star", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Starred ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_star", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to star", error);
    auditMutation("superhuman_star", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function unstarHandler(args: z.infer<typeof UnstarSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_unstar", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would unstar ${args.threadIds.length} thread(s)`);
  }

  const killed = guardMutation("superhuman_unstar", args as Record<string, unknown>);
  if (killed) return killed;

  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await unstarThread(provider, threadId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Unstarred ${succeeded} thread(s)`);
      auditMutation("superhuman_unstar", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to unstar all ${failed} thread(s)`);
      auditMutation("superhuman_unstar", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Unstarred ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_unstar", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to unstar", error);
    auditMutation("superhuman_unstar", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function starredHandler(args: z.infer<typeof StarredSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const limit = args.limit ?? 50;
    const threads = await listStarred(provider, limit);

    if (threads.length === 0) {
      return successResult("No starred threads found");
    }

    const threadsText = threads
      .map((t, i) => `${i + 1}. Thread ID: ${t.id}`)
      .join("\n");

    return successResult(`Starred threads (${threads.length}):\n\n${threadsText}`);
  } catch (error) {
    return actionableError("Failed to list starred threads", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function snoozeHandler(args: z.infer<typeof SnoozeSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_snooze", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would snooze ${args.threadIds.length} thread(s)`);
  }

  const killed = guardMutation("superhuman_snooze", args as Record<string, unknown>);
  if (killed) return killed;

  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let snoozeTime: Date;
  try {
    snoozeTime = parseSnoozeTime(args.until);
  } catch (e) {
    return errorResult(`Invalid snooze time: ${args.until}`);
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

    const results = await snoozeThreadViaProvider(provider, args.threadIds, snoozeTime);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Snoozed ${succeeded} thread(s) until ${snoozeTime.toISOString()}`);
      auditMutation("superhuman_snooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to snooze all ${failed} thread(s)`);
      auditMutation("superhuman_snooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const failedThreads = args.threadIds.filter((_, i) => !results[i]!.success).join(", ");
      const toolResult = successResult(`Snoozed ${succeeded} thread(s), failed on ${failed}: ${failedThreads}`);
      auditMutation("superhuman_snooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to snooze", error);
    auditMutation("superhuman_snooze", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function unsnoozeHandler(args: z.infer<typeof UnsnoozeSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_unsnooze", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would unsnooze ${args.threadIds.length} thread(s)`);
  }

  const killed = guardMutation("superhuman_unsnooze", args as Record<string, unknown>);
  if (killed) return killed;

  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

    const results = await unsnoozeThreadViaProvider(provider, args.threadIds);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Unsnoozed ${succeeded} thread(s)`);
      auditMutation("superhuman_unsnooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to unsnooze all ${failed} thread(s)`);
      auditMutation("superhuman_unsnooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const failedThreads = args.threadIds.filter((_, i) => !results[i]!.success).join(", ");
      const toolResult = successResult(`Unsnoozed ${succeeded} thread(s), failed on ${failed}: ${failedThreads}`);
      auditMutation("superhuman_unsnooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to unsnooze", error);
    auditMutation("superhuman_unsnooze", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function snoozedHandler(args: z.infer<typeof SnoozedSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();

    const limit = args.limit ?? 50;
    const threads = await listSnoozedViaProvider(provider, limit);

    if (threads.length === 0) {
      return successResult("No snoozed threads found");
    }

    const threadsText = threads
      .map((t, i) => {
        const untilStr = t.snoozeUntil ? ` (until ${t.snoozeUntil})` : "";
        return `${i + 1}. Thread ID: ${t.id}${untilStr}`;
      })
      .join("\n");

    return successResult(`Snoozed threads (${threads.length}):\n\n${threadsText}`);
  } catch (error) {
    return actionableError("Failed to list snoozed threads", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

/**
 * Collect ALL threads matching a query via date-anchored pagination.
 * Returns deduplicated threads in chronological order.
 */
async function paginateSearchAll(
  provider: ConnectionProvider,
  query: string,
): Promise<InboxThread[]> {
  const PAGE_SIZE = 50;
  const MAX_PAGES = 100; // safety: 5,000 threads max
  const allThreads = new Map<string, InboxThread>();
  let currentQuery = query;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { threads } = await searchInbox(provider, {
      query: currentQuery,
      limit: PAGE_SIZE,
      includeDone: false, // inbox-only — archive_by_query targets unarchived threads
    });

    if (threads.length === 0) break;

    let newCount = 0;
    for (const thread of threads) {
      if (!allThreads.has(thread.id)) {
        allThreads.set(thread.id, thread);
        newCount++;
      }
    }

    // Proactive cap: stop before wasting API calls on queries that will be rejected
    if (allThreads.size >= 501) break;

    // If we got fewer than PAGE_SIZE, we've reached the end
    if (threads.length < PAGE_SIZE) break;

    // If no new threads, we're stuck in a loop
    if (newCount === 0) break;

    // Date-anchor: use the oldest thread's date as the "before:" boundary
    const oldestDate = threads
      .map((t) => new Date(t.date).getTime())
      .filter((ts) => !Number.isNaN(ts))
      .sort((a, b) => a - b)[0];

    if (!oldestDate) break;

    // Format as YYYY/MM/DD for Gmail query syntax
    // Add 1 day because before: is exclusive — ensures same-day threads aren't skipped
    const d = new Date(oldestDate);
    d.setDate(d.getDate() + 1);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    currentQuery = `${query} before:${dateStr}`;
  }

  // Return sorted chronologically (oldest first)
  return Array.from(allThreads.values()).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

export async function archiveByQueryHandler(args: z.infer<typeof ArchiveByQuerySchema>): Promise<ToolResult> {
  const _t0 = performance.now();

  // Confirmed replay: args shape is { threadIds, originalQuery } from staging,
  // not { query, dryRun } from the original call. Archive pre-resolved threadIds directly.
  if (isConfirmedExecution()) {
    const replayArgs = args as unknown as { threadIds: string[]; originalQuery: string };
    if (!Array.isArray(replayArgs.threadIds) || replayArgs.threadIds.length === 0) {
      return errorResult("Staged operation missing threadIds. Re-stage the archive_by_query operation.");
    }
    const threadIds = replayArgs.threadIds;

    const killed = guardMutation("superhuman_archive_by_query", args as Record<string, unknown>);
    if (killed) return killed;

    let provider: ConnectionProvider | null = null;
    try {
      provider = await getMcpProvider();
      const account = await provider.getCurrentEmail();

      const results: { threadId: string; success: boolean }[] = [];
      for (const threadId of threadIds) {
        const result = await archiveThread(provider, threadId);
        results.push({ threadId, success: result.success });
      }

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      if (failed === 0) {
        const toolResult = successResult(`Archived ${succeeded} thread(s) matching '${replayArgs.originalQuery}'`);
        auditMutation("superhuman_archive_by_query", args as Record<string, unknown>, account, toolResult, {
          batchSize: threadIds.length, durationMs: Math.round(performance.now() - _t0),
        });
        return toolResult;
      } else if (succeeded === 0) {
        const toolResult = errorResult(`Failed to archive all ${failed} thread(s)`);
        auditMutation("superhuman_archive_by_query", args as Record<string, unknown>, account, toolResult, {
          batchSize: threadIds.length, durationMs: Math.round(performance.now() - _t0),
        });
        return toolResult;
      } else {
        const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
        const toolResult = successResult(`Archived ${succeeded}, failed on ${failed}: ${failedIds}`);
        auditMutation("superhuman_archive_by_query", args as Record<string, unknown>, account, toolResult, {
          batchSize: threadIds.length, durationMs: Math.round(performance.now() - _t0),
        });
        return toolResult;
      }
    } catch (error) {
      const toolResult = actionableError("Archive-by-query confirmed execution failed", error);
      auditMutation("superhuman_archive_by_query", args as Record<string, unknown>, "unknown", toolResult, {
        durationMs: Math.round(performance.now() - _t0),
      });
      return toolResult;
    } finally {
      // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
    }
  }

  if (args.dryRun) {
    // Dry run: collect matches and return preview without staging
    let provider: ConnectionProvider | null = null;
    try {
      provider = await getMcpProvider();
      const threads = await paginateSearchAll(provider, args.query);
      auditDryRun("superhuman_archive_by_query", args as Record<string, unknown>, Math.round(performance.now() - _t0));

      if (threads.length === 0) {
        return successResult(`[DRY RUN] Query matched 0 threads: '${args.query}'. Verify the query returns results with superhuman_search first.`);
      }

      const preview = threads.slice(0, 20).map((t, i) =>
        `  ${i + 1}. ${t.id} — "${t.subject}" (from ${t.from.email || t.from.name}, ${t.date})`
      ).join("\n");
      const moreText = threads.length > 20 ? `\n  ... and ${threads.length - 20} more` : "";

      return successResult(`[DRY RUN] Query '${args.query}' matched ${threads.length} thread(s):\n${preview}${moreText}`);
    } catch (error) {
      return actionableError("Archive-by-query dry run failed", error);
    } finally {
      // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
    }
  }

  const killed = guardMutation("superhuman_archive_by_query", args as Record<string, unknown>);
  if (killed) return killed;

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

    // Collect all matching threads via pagination
    const threads = await paginateSearchAll(provider, args.query);

    if (threads.length === 0) {
      return errorResult(`Query matched 0 threads: '${args.query}'. Verify the query returns results with superhuman_search first.`);
    }

    if (threads.length > 500) {
      return errorResult(
        `Query matched ${threads.length} threads (>500). This is unusually large. ` +
        `Add date range or sender filters to narrow the query, or pass dryRun: true to preview matches.`
      );
    }

    const threadIds = threads.map((t) => t.id);

    // Two-phase: stage unless this is a confirmed execution
    if (!isConfirmedExecution()) {
      const manifest = await buildManifest(provider, threadIds);
      const preview = buildBatchPreview("archive", threadIds, manifest);
      const token = stageOperation("superhuman_archive_by_query", { threadIds, originalQuery: args.query } as Record<string, unknown>, preview, account);
      auditMutation("superhuman_archive_by_query", args as Record<string, unknown>, account, successResult(preview), {
        action: "staged", batchSize: threadIds.length, durationMs: Math.round(performance.now() - _t0),
      });
      return successResult(buildStagedResponse(preview, token));
    }

    // Execute: archive all threads
    const results: { threadId: string; success: boolean }[] = [];
    for (const threadId of threadIds) {
      const result = await archiveThread(provider, threadId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Archived ${succeeded} thread(s) matching '${args.query}'`);
      auditMutation("superhuman_archive_by_query", args as Record<string, unknown>, account, toolResult, {
        batchSize: threadIds.length, durationMs: Math.round(performance.now() - _t0),
      });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to archive all ${failed} thread(s)`);
      auditMutation("superhuman_archive_by_query", args as Record<string, unknown>, account, toolResult, {
        batchSize: threadIds.length, durationMs: Math.round(performance.now() - _t0),
      });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Archived ${succeeded}, failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_archive_by_query", args as Record<string, unknown>, account, toolResult, {
        batchSize: threadIds.length, durationMs: Math.round(performance.now() - _t0),
      });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Archive-by-query failed", error);
    auditMutation("superhuman_archive_by_query", args as Record<string, unknown>, "unknown", toolResult, {
      durationMs: Math.round(performance.now() - _t0),
    });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}
