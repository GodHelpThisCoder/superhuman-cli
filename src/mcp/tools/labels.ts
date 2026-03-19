/**
 * MCP tool handlers for label management: list, get, create, add, add-by-query, remove.
 */

import { z } from "zod";
import { listLabels, createNewLabel, getThreadLabels, addLabel, removeLabel } from "../../labels";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, guardMutation, auditMutation, auditDryRun, type ToolResult } from "./shared";
import { paginateSearchAll } from "./email-manage";
import { isConfirmedExecution, stageOperation, buildStagedResponse, buildBatchPreview, buildManifest } from "../confirmation";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const LabelsSchema = z.object({}).strict();

export const GetLabelsSchema = z.object({
  threadId: z.string().describe("The thread ID to get labels for"),
}).strict();

export const AddLabelSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to add the label to"),
  labelId: z.string().describe("The label ID to add"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const CreateLabelSchema = z.object({
  name: z.string().max(225).describe("The name of the new label. Use '/' for nesting (e.g. 'Finance/Taxes')"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const RemoveLabelSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to remove the label from"),
  labelId: z.string().describe("The label ID to remove"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const AddLabelByQuerySchema = z.object({
  query: z.string().describe("Search query whose matching threads will receive the label. Run this query through superhuman_search first to verify what it matches."),
  labelId: z.string().describe("The label ID to add. Use superhuman_labels to get available label IDs."),
  excludeThreadIds: z.array(z.string()).optional().describe("Thread IDs to exclude from labeling. Use to protect specific threads from bulk labeling."),
  dryRun: z.boolean().optional().describe("Preview what would be labeled without executing. Returns matched threads and count."),
}).strict();

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function labelsHandler(_args: z.infer<typeof LabelsSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const labels = await listLabels(provider);

    if (labels.length === 0) {
      return successResult("No labels found");
    }

    const labelsText = labels
      .map((l) => {
        const typeInfo = l.type ? ` (${l.type})` : "";
        return `- ${l.name}${typeInfo}\n  ID: ${l.id}`;
      })
      .join("\n");

    return successResult(`Available labels:\n\n${labelsText}`);
  } catch (error) {
    return actionableError("Failed to list labels", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function getLabelsHandler(args: z.infer<typeof GetLabelsSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const labels = await getThreadLabels(provider, args.threadId);

    if (labels.length === 0) {
      return successResult(`No labels on thread ${args.threadId}`);
    }

    const labelsText = labels
      .map((l) => {
        const typeInfo = l.type ? ` (${l.type})` : "";
        return `- ${l.name}${typeInfo}\n  ID: ${l.id}`;
      })
      .join("\n");

    return successResult(`Labels on thread ${args.threadId}:\n\n${labelsText}`);
  } catch (error) {
    return actionableError("Failed to get thread labels", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function createLabelHandler(args: z.infer<typeof CreateLabelSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_create_label", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would create label "${args.name}"`);
  }

  const killed = guardMutation("superhuman_create_label", args as Record<string, unknown>);
  if (killed) return killed;

  if (!args.name || args.name.trim().length === 0) {
    return errorResult("Label name is required and cannot be empty. Provide a non-empty string (e.g. 'Finance' or 'Finance/Taxes' for nested labels).");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();
    const label = await createNewLabel(provider, args.name.trim());

    const toolResult = successResult(`Created label "${label.name}" (ID: ${label.id})`);
    auditMutation("superhuman_create_label", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } catch (error) {
    const toolResult = actionableError("Failed to create label", error);
    auditMutation("superhuman_create_label", args as Record<string, unknown>, "unknown", toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function addLabelHandler(args: z.infer<typeof AddLabelSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_add_label", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would add label ${args.labelId} to ${args.threadIds.length} thread(s)`);
  }

  const killed = guardMutation("superhuman_add_label", args as Record<string, unknown>);
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
      const result = await addLabel(provider, threadId, args.labelId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Added label to ${succeeded} thread(s)`);
      auditMutation("superhuman_add_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to add label to all ${failed} thread(s)`);
      auditMutation("superhuman_add_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Added label to ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_add_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to add label", error);
    auditMutation("superhuman_add_label", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function addLabelByQueryHandler(args: z.infer<typeof AddLabelByQuerySchema>): Promise<ToolResult> {
  const _t0 = performance.now();

  // --- Confirmed execution path (replay from staging) ---
  if (isConfirmedExecution()) {
    const replayArgs = args as unknown as { threadIds: string[]; originalQuery: string; labelId: string };
    if (!Array.isArray(replayArgs.threadIds) || replayArgs.threadIds.length === 0) {
      return errorResult("Staged operation missing threadIds. Re-stage the add_label_by_query operation.");
    }

    const killed = guardMutation("superhuman_add_label_by_query", args as Record<string, unknown>);
    if (killed) return killed;

    let provider: ConnectionProvider | null = null;
    try {
      provider = await getMcpProvider();
      const account = await provider.getCurrentEmail();
      const results: { threadId: string; success: boolean }[] = [];

      for (const threadId of replayArgs.threadIds) {
        const result = await addLabel(provider, threadId, replayArgs.labelId);
        results.push({ threadId, success: result.success });
      }

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      if (failed === 0) {
        const toolResult = successResult(`Added label to ${succeeded} thread(s) matching '${replayArgs.originalQuery}'`);
        auditMutation("superhuman_add_label_by_query", args as Record<string, unknown>, account, toolResult, {
          batchSize: replayArgs.threadIds.length, durationMs: Math.round(performance.now() - _t0),
        });
        return toolResult;
      } else if (succeeded === 0) {
        const toolResult = errorResult(`Failed to add label to all ${failed} thread(s)`);
        auditMutation("superhuman_add_label_by_query", args as Record<string, unknown>, account, toolResult, {
          batchSize: replayArgs.threadIds.length, durationMs: Math.round(performance.now() - _t0),
        });
        return toolResult;
      } else {
        const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
        const toolResult = successResult(`Added label to ${succeeded}, failed on ${failed}: ${failedIds}`);
        auditMutation("superhuman_add_label_by_query", args as Record<string, unknown>, account, toolResult, {
          batchSize: replayArgs.threadIds.length, durationMs: Math.round(performance.now() - _t0),
        });
        return toolResult;
      }
    } catch (error) {
      const toolResult = actionableError("Add-label-by-query confirmed execution failed", error);
      auditMutation("superhuman_add_label_by_query", args as Record<string, unknown>, "unknown", toolResult, {
        durationMs: Math.round(performance.now() - _t0),
      });
      return toolResult;
    } finally {
      // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
    }
  }

  // --- Dry-run path ---
  if (args.dryRun) {
    let provider: ConnectionProvider | null = null;
    try {
      provider = await getMcpProvider();
      const allThreads = await paginateSearchAll(provider, args.query);
      auditDryRun("superhuman_add_label_by_query", args as Record<string, unknown>, Math.round(performance.now() - _t0));

      const excludeSet = new Set(args.excludeThreadIds ?? []);
      const threads = excludeSet.size > 0 ? allThreads.filter((t) => !excludeSet.has(t.id)) : allThreads;
      const excludedCount = allThreads.length - threads.length;

      if (threads.length === 0) {
        const excludeNote = excludedCount > 0 ? ` (${excludedCount} excluded)` : "";
        return successResult(`[DRY RUN] Query matched ${allThreads.length} thread(s)${excludeNote}, 0 remaining: '${args.query}'. Verify the query returns results with superhuman_search first.`);
      }

      const preview = threads.slice(0, 20).map((t, i) =>
        `  ${i + 1}. ${t.id} — "${t.subject}" (from ${t.from.email || t.from.name}, ${t.date})`
      ).join("\n");
      const moreText = threads.length > 20 ? `\n  ... and ${threads.length - 20} more` : "";
      const excludeNote = excludedCount > 0 ? ` (matched ${allThreads.length}, excluded ${excludedCount}, labeling ${threads.length})` : "";

      return successResult(`[DRY RUN] Query '${args.query}' would label ${threads.length} thread(s) with ${args.labelId}${excludeNote}:\n${preview}${moreText}`);
    } catch (error) {
      return actionableError("Add-label-by-query dry run failed", error);
    } finally {
      // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
    }
  }

  // --- Normal execution path ---
  const killed = guardMutation("superhuman_add_label_by_query", args as Record<string, unknown>);
  if (killed) return killed;

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

    const allThreads = await paginateSearchAll(provider, args.query);

    const excludeSet = new Set(args.excludeThreadIds ?? []);
    const threads = excludeSet.size > 0 ? allThreads.filter((t) => !excludeSet.has(t.id)) : allThreads;
    const excludedCount = allThreads.length - threads.length;

    if (threads.length === 0) {
      const excludeNote = excludedCount > 0 ? ` (${excludedCount} excluded)` : "";
      return errorResult(`Query matched ${allThreads.length} thread(s)${excludeNote}, 0 remaining: '${args.query}'. Verify the query returns results with superhuman_search first.`);
    }

    // Guard against huge batches (>500 threads)
    if (threads.length > 500) {
      const excludeNote = excludedCount > 0 ? ` after ${excludedCount} exclusions` : "";
      return errorResult(
        `Query matched ${threads.length} threads (>500${excludeNote}). This is unusually large. ` +
        `Add date range or sender filters to narrow the query, or pass dryRun: true to preview matches.`
      );
    }

    const threadIds = threads.map((t) => t.id);

    // Two-phase confirmation for >50 threads (labeling is idempotent but bulk should be reviewed)
    if (threadIds.length > 50 && !isConfirmedExecution()) {
      const manifest = await buildManifest(provider, threadIds);
      const excludeNote = excludedCount > 0 ? `\n\nNote: Matched ${allThreads.length}, excluded ${excludedCount}, staging ${threads.length}.` : "";
      const preview = buildBatchPreview("add label", threadIds, manifest) + excludeNote;
      const token = stageOperation("superhuman_add_label_by_query", { threadIds, originalQuery: args.query, labelId: args.labelId } as Record<string, unknown>, preview, account);
      auditMutation("superhuman_add_label_by_query", args as Record<string, unknown>, account, successResult(preview), {
        action: "staged", batchSize: threadIds.length, durationMs: Math.round(performance.now() - _t0),
      });
      return successResult(buildStagedResponse(preview, token));
    }

    // Direct execution for <=50 threads (idempotent, non-destructive)
    const results: { threadId: string; success: boolean }[] = [];
    for (const threadId of threadIds) {
      const result = await addLabel(provider, threadId, args.labelId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Added label ${args.labelId} to ${succeeded} thread(s) matching '${args.query}'`);
      auditMutation("superhuman_add_label_by_query", args as Record<string, unknown>, account, toolResult, {
        batchSize: threadIds.length, durationMs: Math.round(performance.now() - _t0),
      });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to add label to all ${failed} thread(s)`);
      auditMutation("superhuman_add_label_by_query", args as Record<string, unknown>, account, toolResult, {
        batchSize: threadIds.length, durationMs: Math.round(performance.now() - _t0),
      });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Added label to ${succeeded}, failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_add_label_by_query", args as Record<string, unknown>, account, toolResult, {
        batchSize: threadIds.length, durationMs: Math.round(performance.now() - _t0),
      });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Add-label-by-query failed", error);
    auditMutation("superhuman_add_label_by_query", args as Record<string, unknown>, "unknown", toolResult, {
      durationMs: Math.round(performance.now() - _t0),
    });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function removeLabelHandler(args: z.infer<typeof RemoveLabelSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_remove_label", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would remove label ${args.labelId} from ${args.threadIds.length} thread(s)`);
  }

  const killed = guardMutation("superhuman_remove_label", args as Record<string, unknown>);
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
      const result = await removeLabel(provider, threadId, args.labelId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      const toolResult = successResult(`Removed label from ${succeeded} thread(s)`);
      auditMutation("superhuman_remove_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to remove label from all ${failed} thread(s)`);
      auditMutation("superhuman_remove_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Removed label from ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_remove_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to remove label", error);
    auditMutation("superhuman_remove_label", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length, durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}
