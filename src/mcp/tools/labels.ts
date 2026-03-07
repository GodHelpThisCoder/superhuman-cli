/**
 * MCP tool handlers for label management: list, get, add, remove.
 */

import { z } from "zod";
import { listLabels, getThreadLabels, addLabel, removeLabel } from "../../labels";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, type ToolResult } from "./shared";

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
});

export const RemoveLabelSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) to remove the label from"),
  labelId: z.string().describe("The label ID to remove"),
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
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean }[] = [];

    for (const threadId of args.threadIds) {
      const result = await addLabel(provider, threadId, args.labelId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Added label to ${succeeded} thread(s)`);
    } else if (succeeded === 0) {
      return errorResult(`Failed to add label to all ${failed} thread(s)`);
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      return successResult(`Added label to ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
    }
  } catch (error) {
    return actionableError("Failed to add label", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function removeLabelHandler(args: z.infer<typeof RemoveLabelSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean }[] = [];

    for (const threadId of args.threadIds) {
      const result = await removeLabel(provider, threadId, args.labelId);
      results.push({ threadId, success: result.success });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Removed label from ${succeeded} thread(s)`);
    } else if (succeeded === 0) {
      return errorResult(`Failed to remove label from all ${failed} thread(s)`);
    } else {
      const failedIds = results.filter((r) => !r.success).map((r) => r.threadId).join(", ");
      return successResult(`Removed label from ${succeeded} thread(s), failed on ${failed}: ${failedIds}`);
    }
  } catch (error) {
    return actionableError("Failed to remove label", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}
