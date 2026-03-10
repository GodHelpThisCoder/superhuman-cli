/**
 * MCP tool handler for viewing the audit log.
 */

import { z } from "zod";
import { readAuditLog } from "../../audit";
import { successResult, errorResult, type ToolResult } from "./shared";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const AuditLogSchema = z.object({
  limit: z.number().optional().describe("Number of recent entries to return (default: 50)"),
  tool: z.string().optional().describe("Filter to a specific tool name"),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function auditLogHandler(args: z.infer<typeof AuditLogSchema>): Promise<ToolResult> {
  try {
    const entries = await readAuditLog({
      limit: args.limit,
      tool: args.tool,
    });

    if (entries.length === 0) {
      return successResult("No audit log entries found");
    }

    const formatted = entries
      .map((e) => {
        const parts = [
          `[${e.timestamp}]`,
          e.tool,
          e.action,
          e.result,
          e.account,
        ];
        if (e.token) parts.push(`token:${e.token}`);
        if (e.batchSize) parts.push(`batch:${e.batchSize}`);
        if (e.error) parts.push(`error:${e.error}`);
        if (e.dryRun) parts.push("(dry-run)");
        return parts.join(" | ");
      })
      .join("\n");

    return successResult(`Audit log (${entries.length} entries):\n\n${formatted}`);
  } catch (error) {
    return errorResult(`Failed to read audit log: ${error instanceof Error ? error.message : String(error)}`);
  }
}
