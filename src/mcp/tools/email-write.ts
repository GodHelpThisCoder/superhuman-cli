/**
 * MCP tool handlers for composing emails: draft, send, reply, reply-all, forward.
 *
 * send/reply/reply-all/forward support optional file attachments via a
 * two-step flow (create provider draft → add attachments → send).
 * superhuman_draft is the exception: it writes to Superhuman's NATIVE draft
 * store (so drafts appear in the app) and takes no attachments.
 */

import { z } from "zod";
import { textToHtml } from "../../superhuman-api";
import { replyToThread, replyAllToThread, forwardThread } from "../../reply";
import {
  sendEmailViaProvider,
  createDraftViaProvider,
  sendDraftByIdViaProvider,
} from "../../send-api";
import { addAttachmentToDraft } from "../../token-api";
import { createDraftWithUserInfo } from "../../draft-api";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, getUserInfoFromProvider, guardMutation, auditMutation, auditDryRun, type ToolResult } from "./shared";
import { isConfirmedExecution, stageOperation, buildStagedResponse } from "../confirmation";

// ---------------------------------------------------------------------------
// Attachment helpers
// ---------------------------------------------------------------------------

const AttachmentInput = z.object({
  filename: z.string().describe("Filename of the attachment (e.g. 'report.pdf')"),
  content: z.string().describe("Base64-encoded file content"),
  mimeType: z.string().optional().describe("MIME type (e.g. 'application/pdf'). Auto-detected from extension if omitted."),
});

type AttachmentArg = z.infer<typeof AttachmentInput>;

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  html: "text/html",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  wav: "audio/wav",
};

function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return MIME_MAP[ext] || "application/octet-stream";
}

/**
 * Add attachments to a draft. Returns an error message on failure, or null on success.
 */
async function addAttachments(
  provider: ConnectionProvider,
  draftId: string,
  attachments: AttachmentArg[],
): Promise<string | null> {
  const token = await provider.getToken();
  for (const att of attachments) {
    const mimeType = att.mimeType || guessMimeType(att.filename);
    const ok = await addAttachmentToDraft(token, draftId, att.filename, mimeType, att.content);
    if (!ok) {
      return `Failed to add attachment: ${att.filename}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const EmailSchema = z.object({
  to: z.string().describe("Recipient email address(es). Comma-separated for multiple: 'a@x.com, b@y.com'"),
  subject: z.string().describe("Email subject line"),
  body: z.string().describe("Email body content (plain text or HTML)"),
  cc: z.string().optional().describe("CC recipient email address(es). Comma-separated for multiple (optional)"),
  bcc: z.string().optional().describe("BCC recipient email address(es). Comma-separated for multiple (optional)"),
  attachments: z.array(AttachmentInput).optional().describe("File attachments. Each has filename, base64 content, and optional mimeType."),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

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

// Drafts are created in SUPERHUMAN'S OWN draft store (so they appear in the
// app's Drafts view — Gmail API drafts never do). That store has no
// programmatic attachment support, so the draft tool takes no attachments;
// superhuman_send keeps full attachment support via the Gmail draft+send flow.
export const DraftSchema = EmailSchema.omit({ attachments: true });
export const SendSchema = EmailSchema;

export const ReplySchema = z.object({
  threadId: z.string().describe("Thread ID to reply to"),
  body: z.string().describe("Reply message body"),
  send: z.boolean().optional().describe("Send immediately instead of creating draft (default: false)"),
  attachments: z.array(AttachmentInput).optional().describe("File attachments. Each has filename, base64 content, and optional mimeType."),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const ReplyAllSchema = z.object({
  threadId: z.string().describe("Thread ID to reply-all to"),
  body: z.string().describe("Reply message body"),
  send: z.boolean().optional().describe("Send immediately instead of creating draft (default: false)"),
  attachments: z.array(AttachmentInput).optional().describe("File attachments. Each has filename, base64 content, and optional mimeType."),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

export const ForwardSchema = z.object({
  threadId: z.string().describe("Thread ID to forward"),
  toEmail: z.string().describe("Email address to forward to"),
  body: z.string().describe("Message body to include before the forwarded content"),
  send: z.boolean().optional().describe("Send immediately instead of creating draft (default: false)"),
  attachments: z.array(AttachmentInput).optional().describe("File attachments. Each has filename, base64 content, and optional mimeType."),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
}).strict();

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function draftHandler(args: z.infer<typeof DraftSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_draft", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would create draft to ${args.to} with subject "${args.subject}"`);
  }

  const killed = guardMutation("superhuman_draft", args as Record<string, unknown>);
  if (killed) return killed;

  try {
    const provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();
    const htmlBody = textToHtml(args.body);

    // Create the draft in Superhuman's OWN draft store (same proven path the
    // snippet tool uses). Gmail-API drafts (the old createDraftViaProvider
    // path) reported success but never appeared in Superhuman's Drafts view —
    // the app only reads its own store.
    const userInfo = await getUserInfoFromProvider(provider);
    const result = await createDraftWithUserInfo(userInfo, {
      to: splitEmails(args.to),
      subject: args.subject,
      body: htmlBody,
      cc: splitEmailsOpt(args.cc),
      bcc: splitEmailsOpt(args.bcc),
    });

    if (!result.success || !result.draftId) {
      const toolResult = errorResult(`Failed to create draft: ${result.error || "no draft ID returned"}`);
      auditMutation("superhuman_draft", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }

    // threadId is included because it's the only moment it is known — the
    // Superhuman store addresses drafts by (threadId, draftId), and there is
    // no programmatic delete/update, so this is the manual-recovery handle.
    const toolResult = successResult(`Draft created in Superhuman's Drafts view\nDraft ID: ${result.draftId}\nThread ID: ${result.threadId}\nTo: ${args.to}\nSubject: ${args.subject}`);
    auditMutation("superhuman_draft", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } catch (error) {
    const toolResult = actionableError("Failed to create draft", error);
    auditMutation("superhuman_draft", args as Record<string, unknown>, "unknown", toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  }
}

export async function sendHandler(args: z.infer<typeof SendSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_send", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would send email to ${args.to} with subject "${args.subject}"`);
  }

  const killed = guardMutation("superhuman_send", args as Record<string, unknown>);
  if (killed) return killed;

  try {
    const provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

    // Two-phase: stage unless this is a confirmed execution
    if (!isConfirmedExecution()) {
      const preview = `Would send email to ${args.to} with subject "${args.subject}"`;
      const token = stageOperation("superhuman_send", args as Record<string, unknown>, preview, account);
      auditMutation("superhuman_send", args as Record<string, unknown>, account, successResult(preview), { action: "staged", durationMs: Math.round(performance.now() - _t0) });
      return successResult(buildStagedResponse(preview, token));
    }

    const htmlBody = textToHtml(args.body);

    if (args.attachments && args.attachments.length > 0) {
      // Two-step: create draft → add attachments → send draft
      const draftResult = await createDraftViaProvider(provider, {
        to: splitEmails(args.to),
        subject: args.subject,
        body: htmlBody,
        cc: splitEmailsOpt(args.cc),
        bcc: splitEmailsOpt(args.bcc),
      });

      if (!draftResult.success || !draftResult.draftId) {
        const toolResult = errorResult(`Failed to create draft for send: ${draftResult.error || "no draft ID"}`);
        auditMutation("superhuman_send", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }

      const attError = await addAttachments(provider, draftResult.draftId, args.attachments);
      if (attError) {
        const toolResult = errorResult(`Draft created but ${attError}. Draft ID: ${draftResult.draftId}`);
        auditMutation("superhuman_send", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }

      const sendResult = await sendDraftByIdViaProvider(provider, draftResult.draftId);
      if (sendResult.success) {
        const toolResult = successResult(`Email sent successfully to ${args.to} with ${args.attachments.length} attachment(s)`);
        auditMutation("superhuman_send", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }
      const toolResult = errorResult(`Attachments added but send failed: ${sendResult.error}. Draft ID: ${draftResult.draftId}`);
      auditMutation("superhuman_send", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }

    // No attachments — direct send (existing path)
    const result = await sendEmailViaProvider(provider, {
      to: splitEmails(args.to),
      subject: args.subject,
      body: htmlBody,
      cc: splitEmailsOpt(args.cc),
      bcc: splitEmailsOpt(args.bcc),
    });

    if (result.success) {
      const toolResult = successResult(`Email sent successfully to ${args.to}`);
      auditMutation("superhuman_send", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
    const toolResult = errorResult(`Failed to send email: ${result.error}`);
    auditMutation("superhuman_send", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } catch (error) {
    const toolResult = actionableError("Failed to send email", error);
    auditMutation("superhuman_send", args as Record<string, unknown>, "unknown", toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  }
}

export async function replyHandler(args: z.infer<typeof ReplySchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_reply", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would ${args.send ? "send" : "draft"} reply to thread ${args.threadId}`);
  }

  const killed = guardMutation("superhuman_reply", args as Record<string, unknown>);
  if (killed) return killed;

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

    // Two-phase: stage when sending (not drafting)
    if (!isConfirmedExecution() && (args.send ?? false)) {
      const preview = `Would send reply to thread ${args.threadId}`;
      const token = stageOperation("superhuman_reply", args as Record<string, unknown>, preview, account);
      auditMutation("superhuman_reply", args as Record<string, unknown>, account, successResult(preview), { action: "staged", durationMs: Math.round(performance.now() - _t0) });
      return successResult(buildStagedResponse(preview, token));
    }

    const hasAttachments = args.attachments && args.attachments.length > 0;
    const wantSend = args.send ?? false;

    if (hasAttachments) {
      // Two-step: create reply draft → add attachments → optionally send
      const result = await replyToThread(provider, args.threadId, args.body, false);
      if (!result.success || !result.draftId) {
        const toolResult = errorResult(`Failed to create reply draft: ${result.error || "no draft ID"}`);
        auditMutation("superhuman_reply", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }

      const attError = await addAttachments(provider, result.draftId, args.attachments!);
      if (attError) {
        const toolResult = errorResult(`Reply draft created but ${attError}. Draft ID: ${result.draftId}`);
        auditMutation("superhuman_reply", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }

      if (wantSend) {
        const sendResult = await sendDraftByIdViaProvider(provider, result.draftId);
        if (sendResult.success) {
          const toolResult = successResult(`Reply sent to thread ${args.threadId} with ${args.attachments!.length} attachment(s)`);
          auditMutation("superhuman_reply", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
          return toolResult;
        }
        const toolResult = errorResult(`Reply with attachments created but send failed: ${sendResult.error}. Draft ID: ${result.draftId}`);
        auditMutation("superhuman_reply", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }

      const toolResult = successResult(`Reply draft created for thread ${args.threadId}\nDraft ID: ${result.draftId}\nAttachments: ${args.attachments!.length}`);
      auditMutation("superhuman_reply", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }

    // No attachments — existing path
    const result = await replyToThread(provider, args.threadId, args.body, wantSend);
    if (!result.success) {
      throw new Error(result.error || "Failed to create reply");
    }

    if (wantSend) {
      const toolResult = successResult(`Reply sent successfully to thread ${args.threadId}`);
      auditMutation("superhuman_reply", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
    const toolResult = successResult(`Reply draft created for thread ${args.threadId}${result.draftId ? `\nDraft ID: ${result.draftId}` : ""}`);
    auditMutation("superhuman_reply", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } catch (error) {
    const toolResult = actionableError("Failed to reply", error);
    auditMutation("superhuman_reply", args as Record<string, unknown>, "unknown", toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function replyAllHandler(args: z.infer<typeof ReplyAllSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_reply_all", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would ${args.send ? "send" : "draft"} reply-all to thread ${args.threadId}`);
  }

  const killed = guardMutation("superhuman_reply_all", args as Record<string, unknown>);
  if (killed) return killed;

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

    // Two-phase: stage when sending (not drafting)
    if (!isConfirmedExecution() && (args.send ?? false)) {
      const preview = `Would send reply-all to thread ${args.threadId}`;
      const token = stageOperation("superhuman_reply_all", args as Record<string, unknown>, preview, account);
      auditMutation("superhuman_reply_all", args as Record<string, unknown>, account, successResult(preview), { action: "staged", durationMs: Math.round(performance.now() - _t0) });
      return successResult(buildStagedResponse(preview, token));
    }

    const hasAttachments = args.attachments && args.attachments.length > 0;
    const wantSend = args.send ?? false;

    if (hasAttachments) {
      const result = await replyAllToThread(provider, args.threadId, args.body, false);
      if (!result.success || !result.draftId) {
        const toolResult = errorResult(`Failed to create reply-all draft: ${result.error || "no draft ID"}`);
        auditMutation("superhuman_reply_all", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }

      const attError = await addAttachments(provider, result.draftId, args.attachments!);
      if (attError) {
        const toolResult = errorResult(`Reply-all draft created but ${attError}. Draft ID: ${result.draftId}`);
        auditMutation("superhuman_reply_all", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }

      if (wantSend) {
        const sendResult = await sendDraftByIdViaProvider(provider, result.draftId);
        if (sendResult.success) {
          const toolResult = successResult(`Reply-all sent to thread ${args.threadId} with ${args.attachments!.length} attachment(s)`);
          auditMutation("superhuman_reply_all", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
          return toolResult;
        }
        const toolResult = errorResult(`Reply-all with attachments created but send failed: ${sendResult.error}. Draft ID: ${result.draftId}`);
        auditMutation("superhuman_reply_all", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }

      const toolResult = successResult(`Reply-all draft created for thread ${args.threadId}\nDraft ID: ${result.draftId}\nAttachments: ${args.attachments!.length}`);
      auditMutation("superhuman_reply_all", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }

    // No attachments — existing path
    const result = await replyAllToThread(provider, args.threadId, args.body, wantSend);
    if (!result.success) {
      throw new Error(result.error || "Failed to create reply-all");
    }

    if (wantSend) {
      const toolResult = successResult(`Reply-all sent successfully to thread ${args.threadId}`);
      auditMutation("superhuman_reply_all", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
    const toolResult = successResult(`Reply-all draft created for thread ${args.threadId}${result.draftId ? `\nDraft ID: ${result.draftId}` : ""}`);
    auditMutation("superhuman_reply_all", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } catch (error) {
    const toolResult = actionableError("Failed to reply-all", error);
    auditMutation("superhuman_reply_all", args as Record<string, unknown>, "unknown", toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function forwardHandler(args: z.infer<typeof ForwardSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_forward", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would ${args.send ? "send" : "draft"} forward of thread ${args.threadId} to ${args.toEmail}`);
  }

  const killed = guardMutation("superhuman_forward", args as Record<string, unknown>);
  if (killed) return killed;

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

    // Two-phase: stage when sending (not drafting)
    if (!isConfirmedExecution() && (args.send ?? false)) {
      const preview = `Would forward thread ${args.threadId} to ${args.toEmail}`;
      const token = stageOperation("superhuman_forward", args as Record<string, unknown>, preview, account);
      auditMutation("superhuman_forward", args as Record<string, unknown>, account, successResult(preview), { action: "staged", durationMs: Math.round(performance.now() - _t0) });
      return successResult(buildStagedResponse(preview, token));
    }

    const hasAttachments = args.attachments && args.attachments.length > 0;
    const wantSend = args.send ?? false;

    if (hasAttachments) {
      const result = await forwardThread(provider, args.threadId, args.toEmail, args.body, false);
      if (!result.success || !result.draftId) {
        const toolResult = errorResult(`Failed to create forward draft: ${result.error || "no draft ID"}`);
        auditMutation("superhuman_forward", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }

      const attError = await addAttachments(provider, result.draftId, args.attachments!);
      if (attError) {
        const toolResult = errorResult(`Forward draft created but ${attError}. Draft ID: ${result.draftId}`);
        auditMutation("superhuman_forward", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }

      if (wantSend) {
        const sendResult = await sendDraftByIdViaProvider(provider, result.draftId);
        if (sendResult.success) {
          const toolResult = successResult(`Email forwarded to ${args.toEmail} with ${args.attachments!.length} attachment(s)`);
          auditMutation("superhuman_forward", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
          return toolResult;
        }
        const toolResult = errorResult(`Forward with attachments created but send failed: ${sendResult.error}. Draft ID: ${result.draftId}`);
        auditMutation("superhuman_forward", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
        return toolResult;
      }

      const toolResult = successResult(`Forward draft created for ${args.toEmail}\nDraft ID: ${result.draftId}\nAttachments: ${args.attachments!.length}`);
      auditMutation("superhuman_forward", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }

    // No attachments — existing path
    const result = await forwardThread(provider, args.threadId, args.toEmail, args.body, wantSend);
    if (!result.success) {
      throw new Error(result.error || "Failed to create forward");
    }

    if (wantSend) {
      const toolResult = successResult(`Email forwarded successfully to ${args.toEmail}`);
      auditMutation("superhuman_forward", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
    const toolResult = successResult(`Forward draft created for ${args.toEmail}${result.draftId ? `\nDraft ID: ${result.draftId}` : ""}`);
    auditMutation("superhuman_forward", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } catch (error) {
    const toolResult = actionableError("Failed to forward", error);
    auditMutation("superhuman_forward", args as Record<string, unknown>, "unknown", toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}
