/**
 * MCP tool handlers for email management: archive, delete, mark read/unread,
 * star/unstar, snooze/unsnooze.
 */

import { z } from "zod";
import { archiveThread, deleteThread } from "../../archive";
import { markAsRead, markAsUnread } from "../../read-status";
import { starThread, unstarThread, listStarred } from "../../labels";
import { parseSnoozeTime, snoozeThreadViaProvider, unsnoozeThreadViaProvider, listSnoozedViaProvider } from "../../snooze";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, guardMutation, auditMutation, type ToolResult } from "./shared";
import { isConfirmedExecution, stageOperation, buildStagedResponse, buildBatchPreview } from "../confirmation";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ArchiveSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to archive"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const DeleteSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to delete (move to trash)"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const MarkReadSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to mark as read"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const MarkUnreadSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to mark as unread"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const StarSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to star"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const UnstarSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to unstar"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const StarredSchema = z.object({
  limit: z.number().optional().describe("Maximum number of starred threads to return (default: 50)"),
});

export const SnoozeSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to snooze"),
  until: z.union([
    z.enum(["tomorrow", "next-week", "weekend", "evening"]),
    z.string().describe("ISO datetime (e.g., 2026-03-10T14:00:00Z)"),
  ]).describe("When to unsnooze: use a preset or provide an ISO datetime"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const UnsnoozeSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to unsnooze"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const SnoozedSchema = z.object({
  limit: z.number().optional().describe("Maximum number of snoozed threads to return (default: 50)"),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function archiveHandler(args: z.infer<typeof ArchiveSchema>): Promise<ToolResult> {
  if (args.dryRun) {
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
        const preview = buildBatchPreview("archive", args.threadIds);
        const token = stageOperation("superhuman_archive", args as Record<string, unknown>, preview, account);
        auditMutation("superhuman_archive", args as Record<string, unknown>, account, successResult(preview), { action: "staged", batchSize: args.threadIds.length });
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
      auditMutation("superhuman_archive", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to archive all ${failed} thread(s)`);
      auditMutation("superhuman_archive", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Archived ${succeeded} thread(s), failed to archive ${failed}: ${failedIds}`);
      auditMutation("superhuman_archive", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to archive", error);
    auditMutation("superhuman_archive", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length });
    return toolResult;
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function deleteHandler(args: z.infer<typeof DeleteSchema>): Promise<ToolResult> {
  if (args.dryRun) {
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
        const preview = buildBatchPreview("delete", args.threadIds);
        const token = stageOperation("superhuman_delete", args as Record<string, unknown>, preview, account);
        auditMutation("superhuman_delete", args as Record<string, unknown>, account, successResult(preview), { action: "staged", batchSize: args.threadIds.length });
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
      auditMutation("superhuman_delete", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to delete all ${failed} thread(s)`);
      auditMutation("superhuman_delete", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Deleted ${succeeded} thread(s), failed to delete ${failed}: ${failedIds}`);
      auditMutation("superhuman_delete", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to delete", error);
    auditMutation("superhuman_delete", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length });
    return toolResult;
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function markReadHandler(args: z.infer<typeof MarkReadSchema>): Promise<ToolResult> {
  if (args.dryRun) {
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
      auditMutation("superhuman_mark_read", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to mark all ${failed} thread(s) as read`);
      auditMutation("superhuman_mark_read", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Marked ${succeeded} thread(s) as read, failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_mark_read", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to mark as read", error);
    auditMutation("superhuman_mark_read", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length });
    return toolResult;
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function markUnreadHandler(args: z.infer<typeof MarkUnreadSchema>): Promise<ToolResult> {
  if (args.dryRun) {
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
      auditMutation("superhuman_mark_unread", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to mark all ${failed} thread(s) as unread`);
      auditMutation("superhuman_mark_unread", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Marked ${succeeded} thread(s) as unread, failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_mark_unread", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to mark as unread", error);
    auditMutation("superhuman_mark_unread", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length });
    return toolResult;
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function starHandler(args: z.infer<typeof StarSchema>): Promise<ToolResult> {
  if (args.dryRun) {
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
      auditMutation("superhuman_star", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to star all ${failed} thread(s)`);
      auditMutation("superhuman_star", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Starred ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_star", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to star", error);
    auditMutation("superhuman_star", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length });
    return toolResult;
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function unstarHandler(args: z.infer<typeof UnstarSchema>): Promise<ToolResult> {
  if (args.dryRun) {
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
      auditMutation("superhuman_unstar", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to unstar all ${failed} thread(s)`);
      auditMutation("superhuman_unstar", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Unstarred ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_unstar", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to unstar", error);
    auditMutation("superhuman_unstar", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length });
    return toolResult;
  } finally {
    if (provider) await provider.disconnect();
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
    if (provider) await provider.disconnect();
  }
}

export async function snoozeHandler(args: z.infer<typeof SnoozeSchema>): Promise<ToolResult> {
  if (args.dryRun) {
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
      auditMutation("superhuman_snooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to snooze all ${failed} thread(s)`);
      auditMutation("superhuman_snooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else {
      const failedThreads = args.threadIds.filter((_, i) => !results[i]!.success).join(", ");
      const toolResult = successResult(`Snoozed ${succeeded} thread(s), failed on ${failed}: ${failedThreads}`);
      auditMutation("superhuman_snooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to snooze", error);
    auditMutation("superhuman_snooze", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length });
    return toolResult;
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function unsnoozeHandler(args: z.infer<typeof UnsnoozeSchema>): Promise<ToolResult> {
  if (args.dryRun) {
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
      auditMutation("superhuman_unsnooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to unsnooze all ${failed} thread(s)`);
      auditMutation("superhuman_unsnooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else {
      const failedThreads = args.threadIds.filter((_, i) => !results[i]!.success).join(", ");
      const toolResult = successResult(`Unsnoozed ${succeeded} thread(s), failed on ${failed}: ${failedThreads}`);
      auditMutation("superhuman_unsnooze", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to unsnooze", error);
    auditMutation("superhuman_unsnooze", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length });
    return toolResult;
  } finally {
    if (provider) await provider.disconnect();
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
    if (provider) await provider.disconnect();
  }
}
