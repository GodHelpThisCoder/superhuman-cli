/**
 * MCP tool handlers for composing emails: draft, send, reply, reply-all, forward.
 */

import { z } from "zod";
import { textToHtml } from "../../superhuman-api";
import { replyToThread, replyAllToThread, forwardThread } from "../../reply";
import { sendEmailViaProvider, createDraftViaProvider } from "../../send-api";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, type ToolResult } from "./shared";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const EmailSchema = z.object({
  to: z.string().describe("Recipient email address(es). Comma-separated for multiple: 'a@x.com, b@y.com'"),
  subject: z.string().describe("Email subject line"),
  body: z.string().describe("Email body content (plain text or HTML)"),
  cc: z.string().optional().describe("CC recipient email address(es). Comma-separated for multiple (optional)"),
  bcc: z.string().optional().describe("BCC recipient email address(es). Comma-separated for multiple (optional)"),
});

/** Split a comma-separated email string into an array of trimmed addresses. */
function splitEmails(s: string): string[] {
  return s.split(",").map((e) => e.trim()).filter(Boolean);
}

/** Split an optional comma-separated email string into an array, or undefined. */
function splitEmailsOpt(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const result = splitEmails(s);
  return result.length > 0 ? result : undefined;
}

export const DraftSchema = EmailSchema;
export const SendSchema = EmailSchema;

export const ReplySchema = z.object({
  threadId: z.string().describe("Thread ID to reply to"),
  body: z.string().describe("Reply message body"),
  send: z.boolean().optional().describe("Send immediately instead of creating draft (default: false)"),
});

export const ReplyAllSchema = z.object({
  threadId: z.string().describe("Thread ID to reply-all to"),
  body: z.string().describe("Reply message body"),
  send: z.boolean().optional().describe("Send immediately instead of creating draft (default: false)"),
});

export const ForwardSchema = z.object({
  threadId: z.string().describe("Thread ID to forward"),
  toEmail: z.string().describe("Email address to forward to"),
  body: z.string().describe("Message body to include before the forwarded content"),
  send: z.boolean().optional().describe("Send immediately instead of creating draft (default: false)"),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function draftHandler(args: z.infer<typeof DraftSchema>): Promise<ToolResult> {
  try {
    const provider = await getMcpProvider();
    try {
      const htmlBody = textToHtml(args.body);
      const result = await createDraftViaProvider(provider, {
        to: splitEmails(args.to),
        subject: args.subject,
        body: htmlBody,
        cc: splitEmailsOpt(args.cc),
        bcc: splitEmailsOpt(args.bcc),
      });

      if (result.success) {
        return successResult(`Draft created successfully${result.draftId ? `\nDraft ID: ${result.draftId}` : ""}`);
      } else {
        return errorResult(`Failed to create draft: ${result.error}`);
      }
    } finally {
      await provider.disconnect();
    }
  } catch (error) {
    return actionableError("Failed to create draft", error);
  }
}

export async function sendHandler(args: z.infer<typeof SendSchema>): Promise<ToolResult> {
  try {
    const provider = await getMcpProvider();
    try {
      const htmlBody = textToHtml(args.body);
      const result = await sendEmailViaProvider(provider, {
        to: splitEmails(args.to),
        subject: args.subject,
        body: htmlBody,
        cc: splitEmailsOpt(args.cc),
        bcc: splitEmailsOpt(args.bcc),
      });

      if (result.success) {
        return successResult(`Email sent successfully to ${args.to}`);
      } else {
        return errorResult(`Failed to send email: ${result.error}`);
      }
    } finally {
      await provider.disconnect();
    }
  } catch (error) {
    return actionableError("Failed to send email", error);
  }
}

export async function replyHandler(args: z.infer<typeof ReplySchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const send = args.send ?? false;
    const result = await replyToThread(provider, args.threadId, args.body, send);

    if (!result.success) {
      throw new Error(result.error || "Failed to create reply");
    }

    if (send) {
      return successResult(`Reply sent successfully to thread ${args.threadId}`);
    } else {
      return successResult(`Reply draft created for thread ${args.threadId}${result.draftId ? `\nDraft ID: ${result.draftId}` : ""}`);
    }
  } catch (error) {
    return actionableError("Failed to reply", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function replyAllHandler(args: z.infer<typeof ReplyAllSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const send = args.send ?? false;
    const result = await replyAllToThread(provider, args.threadId, args.body, send);

    if (!result.success) {
      throw new Error(result.error || "Failed to create reply-all");
    }

    if (send) {
      return successResult(`Reply-all sent successfully to thread ${args.threadId}`);
    } else {
      return successResult(`Reply-all draft created for thread ${args.threadId}${result.draftId ? `\nDraft ID: ${result.draftId}` : ""}`);
    }
  } catch (error) {
    return actionableError("Failed to reply-all", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}

export async function forwardHandler(args: z.infer<typeof ForwardSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const send = args.send ?? false;
    const result = await forwardThread(provider, args.threadId, args.toEmail, args.body, send);

    if (!result.success) {
      throw new Error(result.error || "Failed to create forward");
    }

    if (send) {
      return successResult(`Email forwarded successfully to ${args.toEmail}`);
    } else {
      return successResult(`Forward draft created for ${args.toEmail}${result.draftId ? `\nDraft ID: ${result.draftId}` : ""}`);
    }
  } catch (error) {
    return actionableError("Failed to forward", error);
  } finally {
    if (provider) await provider.disconnect();
  }
}
