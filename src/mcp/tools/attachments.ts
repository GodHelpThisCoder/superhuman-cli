/**
 * MCP tool handlers for attachments: list and download.
 */

import { z } from "zod";
import { listAttachments, downloadAttachment } from "../../attachments";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, type ToolResult } from "./shared";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const AttachmentsSchema = z.object({
  threadId: z.string().describe("The thread ID to list attachments for"),
});

export const DownloadAttachmentSchema = z.object({
  messageId: z.string().describe("The message ID containing the attachment"),
  attachmentId: z.string().describe("The attachment ID to download"),
  threadId: z.string().optional().describe("The thread ID (optional, helps with some providers)"),
  mimeType: z.string().optional().describe("The MIME type of the attachment (optional)"),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function attachmentsHandler(args: z.infer<typeof AttachmentsSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const attachments = await listAttachments(provider, args.threadId);

    if (attachments.length === 0) {
      return successResult(`No attachments found in thread ${args.threadId}`);
    }

    const attachmentsText = attachments
      .map((att, i) => {
        return `${i + 1}. ${att.name}\n   MIME Type: ${att.mimeType}\n   Attachment ID: ${att.attachmentId}\n   Message ID: ${att.messageId}`;
      })
      .join("\n\n");

    return successResult(`Attachments in thread ${args.threadId} (${attachments.length}):\n\n${attachmentsText}`);
  } catch (error) {
    return actionableError("Failed to list attachments", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function downloadAttachmentHandler(args: z.infer<typeof DownloadAttachmentSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const content = await downloadAttachment(provider, args.messageId, args.attachmentId, args.threadId, args.mimeType);

    return successResult(JSON.stringify({
      data: content.data,
      size: content.size,
      mimeType: args.mimeType || "application/octet-stream",
    }));
  } catch (error) {
    return actionableError("Failed to download attachment", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}
