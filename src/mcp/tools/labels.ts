/**
 * MCP tool handlers for label management: list, get, add, remove.
 */

import { z } from "zod";
import { listLabels, getThreadLabels, addLabel, removeLabel } from "../../labels";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, guardMutation, auditMutation, type ToolResult } from "./shared";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const LabelsSchema = z.object({});

export const GetLabelsSchema = z.object({
  threadId: z.string().describe("The thread ID to get labels for"),
});

export const AddLabelSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to add the label to"),
  labelId: z.string().describe("The label ID to add"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const RemoveLabelSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to remove the label from"),
  labelId: z.string().describe("The label ID to remove"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

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
    if (provider) await provider.disconnect();
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
    if (provider) await provider.disconnect();
  }
}

export async function addLabelHandler(args: z.infer<typeof AddLabelSchema>): Promise<ToolResult> {
  if (args.dryRun) {
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
      auditMutation("superhuman_add_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to add label to all ${failed} thread(s)`);
      auditMutation("superhuman_add_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Added label to ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_add_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to add label", error);
    auditMutation("superhuman_add_label", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length });
    return toolResult;
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function removeLabelHandler(args: z.infer<typeof RemoveLabelSchema>): Promise<ToolResult> {
  if (args.dryRun) {
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
      auditMutation("superhuman_remove_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else if (succeeded === 0) {
      const toolResult = errorResult(`Failed to remove label from all ${failed} thread(s)`);
      auditMutation("superhuman_remove_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      const toolResult = successResult(`Removed label from ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
      auditMutation("superhuman_remove_label", args as Record<string, unknown>, account, toolResult, { batchSize: args.threadIds.length });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to remove label", error);
    auditMutation("superhuman_remove_label", args as Record<string, unknown>, "unknown", toolResult, { batchSize: args.threadIds.length });
    return toolResult;
  } finally {
    if (provider) await provider.disconnect();
  }
}
