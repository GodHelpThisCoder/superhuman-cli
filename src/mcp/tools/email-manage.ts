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
import { successResult, errorResult, actionableError, getMcpProvider, type ToolResult } from "./shared";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ArchiveSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to archive"),
});

export const DeleteSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to delete (move to trash)"),
});

export const MarkReadSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to mark as read"),
});

export const MarkUnreadSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to mark as unread"),
});

export const StarSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to star"),
});

export const UnstarSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to unstar"),
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
});

export const UnsnoozeSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to unsnooze"),
});

export const SnoozedSchema = z.object({
  limit: z.number().optional().describe("Maximum number of snoozed threads to return (default: 50)"),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function archiveHandler(args: z.infer<typeof ArchiveSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean }[] = [];

    for (const threadId of args.threadIds) {
      const result = await archiveThread(provider, threadId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Archived ${succeeded} thread(s) successfully`);
    } else if (succeeded === 0) {
      return errorResult(`Failed to archive all ${failed} thread(s)`);
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      return successResult(`Archived ${succeeded} thread(s), failed to archive ${failed}: ${failedIds}`);
    }
  } catch (error) {
    return actionableError("Failed to archive", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function deleteHandler(args: z.infer<typeof DeleteSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean }[] = [];

    for (const threadId of args.threadIds) {
      const result = await deleteThread(provider, threadId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Deleted ${succeeded} thread(s) successfully`);
    } else if (succeeded === 0) {
      return errorResult(`Failed to delete all ${failed} thread(s)`);
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      return successResult(`Deleted ${succeeded} thread(s), failed to delete ${failed}: ${failedIds}`);
    }
  } catch (error) {
    return actionableError("Failed to delete", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function markReadHandler(args: z.infer<typeof MarkReadSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean }[] = [];

    for (const threadId of args.threadIds) {
      const result = await markAsRead(provider, threadId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Marked ${succeeded} thread(s) as read`);
    } else if (succeeded === 0) {
      return errorResult(`Failed to mark all ${failed} thread(s) as read`);
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      return successResult(`Marked ${succeeded} thread(s) as read, failed on ${failed}: ${failedIds}`);
    }
  } catch (error) {
    return actionableError("Failed to mark as read", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function markUnreadHandler(args: z.infer<typeof MarkUnreadSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean }[] = [];

    for (const threadId of args.threadIds) {
      const result = await markAsUnread(provider, threadId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Marked ${succeeded} thread(s) as unread`);
    } else if (succeeded === 0) {
      return errorResult(`Failed to mark all ${failed} thread(s) as unread`);
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      return successResult(`Marked ${succeeded} thread(s) as unread, failed on ${failed}: ${failedIds}`);
    }
  } catch (error) {
    return actionableError("Failed to mark as unread", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function starHandler(args: z.infer<typeof StarSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await starThread(provider, threadId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Starred ${succeeded} thread(s)`);
    } else if (succeeded === 0) {
      return errorResult(`Failed to star all ${failed} thread(s)`);
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      return successResult(`Starred ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
    }
  } catch (error) {
    return actionableError("Failed to star", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function unstarHandler(args: z.infer<typeof UnstarSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await unstarThread(provider, threadId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Unstarred ${succeeded} thread(s)`);
    } else if (succeeded === 0) {
      return errorResult(`Failed to unstar all ${failed} thread(s)`);
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      return successResult(`Unstarred ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
    }
  } catch (error) {
    return actionableError("Failed to unstar", error);
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

    const results = await snoozeThreadViaProvider(provider, args.threadIds, snoozeTime);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Snoozed ${succeeded} thread(s) until ${snoozeTime.toISOString()}`);
    } else if (succeeded === 0) {
      return errorResult(`Failed to snooze all ${failed} thread(s)`);
    } else {
      const failedThreads = args.threadIds.filter((_, i) => !results[i]!.success).join(", ");
      return successResult(`Snoozed ${succeeded} thread(s), failed on ${failed}: ${failedThreads}`);
    }
  } catch (error) {
    return actionableError("Failed to snooze", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function unsnoozeHandler(args: z.infer<typeof UnsnoozeSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();

    const results = await unsnoozeThreadViaProvider(provider, args.threadIds);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Unsnoozed ${succeeded} thread(s)`);
    } else if (succeeded === 0) {
      return errorResult(`Failed to unsnooze all ${failed} thread(s)`);
    } else {
      const failedThreads = args.threadIds.filter((_, i) => !results[i]!.success).join(", ");
      return successResult(`Unsnoozed ${succeeded} thread(s), failed on ${failed}: ${failedThreads}`);
    }
  } catch (error) {
    return actionableError("Failed to unsnooze", error);
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
