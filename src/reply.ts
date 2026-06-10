/**
 * Reply Module
 *
 * Functions for replying to and forwarding email threads via direct API.
 * Uses token-based API calls (no CDP/browser connection needed).
 */

import type { ConnectionProvider } from "./connection-provider";
import { textToHtml } from "./superhuman-api.js";
import {
  sendReplyWithToken,
  sendEmailWithToken,
  createReplyDraftWithToken,
  createDraftWithToken,
  getThreadInfoForReplyWithToken,
  type ThreadInfoForReply,
} from "./send-api.js";
import { getThreadMessages } from "./token-api";
import { createDraftWithUserInfo, type UserInfo } from "./draft-api";

export interface ReplyResult {
  success: boolean;
  draftId?: string;
  /** Set only for Superhuman-native drafts (the thread the draft is attached to). */
  threadId?: string;
  messageId?: string;
  error?: string;
}

/**
 * Build reply recipients from thread info, mirroring the provider-path
 * semantics in gmail-client's createReplyDraft: plain reply targets the
 * last sender (even if self — replying to your own thread is valid);
 * reply-all adds all To/Cc minus self, case-insensitively deduped.
 */
function buildReplyRecipients(
  info: ThreadInfoForReply,
  replyAll: boolean,
): { to: string[]; cc: string[] } {
  const me = (info.myEmail || "").toLowerCase();
  const to: string[] = [];
  const cc: string[] = [];

  if (replyAll) {
    if (info.replyTo && info.replyTo.toLowerCase() !== me) {
      to.push(info.replyTo);
    }
    for (const email of info.allTo) {
      if (email.toLowerCase() !== me && !to.some((e) => e.toLowerCase() === email.toLowerCase())) {
        to.push(email);
      }
    }
    for (const email of info.allCc) {
      if (email.toLowerCase() !== me && !cc.some((e) => e.toLowerCase() === email.toLowerCase())) {
        cc.push(email);
      }
    }
  } else if (info.replyTo) {
    to.push(info.replyTo);
  }

  return { to, cc };
}

/**
 * Reply to a thread (reply to sender only).
 *
 * Uses direct Gmail/Graph API for both sending and draft creation.
 */
export async function replyToThread(
  provider: ConnectionProvider,
  threadId: string,
  body: string,
  send: boolean = false,
  userInfo?: UserInfo
): Promise<ReplyResult> {
  return replyImpl(provider, threadId, body, send, false, userInfo);
}

/**
 * Reply-all to a thread (reply to all recipients).
 *
 * Uses direct Gmail/Graph API for both sending and draft creation.
 */
export async function replyAllToThread(
  provider: ConnectionProvider,
  threadId: string,
  body: string,
  send: boolean = false,
  userInfo?: UserInfo
): Promise<ReplyResult> {
  return replyImpl(provider, threadId, body, send, true, userInfo);
}

/**
 * Shared implementation for reply and reply-all.
 */
async function replyImpl(
  provider: ConnectionProvider,
  threadId: string,
  body: string,
  send: boolean,
  replyAll: boolean,
  userInfo?: UserInfo
): Promise<ReplyResult> {
  const token = await provider.getToken();
  const htmlBody = textToHtml(body);
  const opts = { replyAll, isHtml: true };

  if (send) {
    const result = await sendReplyWithToken(token, threadId, htmlBody, opts);
    if (result.success) {
      return { success: true, messageId: result.messageId };
    }
    return { success: false, error: result.error };
  }

  // Draft mode — prefer Superhuman's native store so the draft is visible
  // (and editable/sendable) on the thread in the app; provider drafts are
  // never shown by Superhuman. Microsoft accounts keep the provider path:
  // the native store is unverified against MS conversation IDs.
  if (userInfo && !token.isMicrosoft) {
    const info = await getThreadInfoForReplyWithToken(token, threadId);
    if (!info) {
      return { success: false, error: "Could not get thread information for reply" };
    }

    const { to, cc } = buildReplyRecipients(info, replyAll);
    if (to.length === 0) {
      return { success: false, error: "Could not determine reply recipients" };
    }

    const subject = info.subject.startsWith("Re:") ? info.subject : `Re: ${info.subject}`;

    // info.references already ends with the last message's Message-ID
    // (getThreadInfo appends it), so it is the complete RFC 5322 chain.
    const result = await createDraftWithUserInfo(userInfo, {
      action: "reply",
      inReplyToThreadId: threadId,
      inReplyToRfc822Id: info.lastMessageId || undefined,
      references: info.references,
      to,
      cc,
      subject,
      body: htmlBody,
    });

    if (result.success) {
      return { success: true, draftId: result.draftId, threadId: result.threadId };
    }
    return { success: false, error: result.error };
  }

  const result = await createReplyDraftWithToken(token, threadId, htmlBody, opts);
  if (result.success) {
    return { success: true, draftId: result.draftId };
  }
  return { success: false, error: result.error };
}

/**
 * Forward a thread
 *
 * Fetches the original message content and constructs a forwarded email
 * with proper "Forwarded message" header. Uses direct API for both
 * sending and draft creation.
 *
 * @param provider - Connection provider for token resolution
 * @param threadId - The thread ID to forward
 * @param toEmail - The email address to forward to
 * @param body - The message body to include before the forwarded content
 * @param send - If true, send immediately; if false, save as draft
 * @returns Result with success status, optional draft ID, and error message if failed
 */
export async function forwardThread(
  provider: ConnectionProvider,
  threadId: string,
  toEmail: string,
  body: string,
  send: boolean = false,
  userInfo?: UserInfo
): Promise<ReplyResult> {
  const token = await provider.getToken();

  // Get thread info for headers (subject, from, to, date)
  const threadInfo = await getThreadInfoForReplyWithToken(token, threadId);
  if (!threadInfo) {
    return { success: false, error: "Could not get thread information for forward" };
  }

  // Get thread messages for the original body content
  const messages = await getThreadMessages(token, threadId);
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const originalBody = lastMessage?.body || "";

  // Build subject with Fwd: prefix
  const subject = threadInfo.subject.startsWith("Fwd:")
    ? threadInfo.subject
    : `Fwd: ${threadInfo.subject}`;

  // Build the forwarded message body
  const userHtml = body ? textToHtml(body) : "";
  const forwardBody = buildForwardBody({
    userHtml,
    from: threadInfo.replyTo || "unknown",
    date: lastMessage?.date || new Date().toUTCString(),
    subject: threadInfo.subject,
    to: threadInfo.allTo.join(", ") || "unknown",
    originalBody,
  });

  if (send) {
    const result = await sendEmailWithToken(token, {
      to: [toEmail],
      subject,
      body: forwardBody,
      isHtml: true,
    });

    if (result.success) {
      return { success: true, messageId: result.messageId };
    }
    return { success: false, error: result.error };
  }

  // Draft mode — same native-store preference as replyImpl (visible in-app;
  // provider drafts are not). MS accounts keep the provider path.
  if (userInfo && !token.isMicrosoft) {
    const result = await createDraftWithUserInfo(userInfo, {
      action: "forward",
      inReplyToThreadId: threadId,
      inReplyToRfc822Id: threadInfo.lastMessageId || undefined,
      references: threadInfo.references,
      to: [toEmail],
      subject,
      body: forwardBody,
    });

    if (result.success) {
      return { success: true, draftId: result.draftId, threadId: result.threadId };
    }
    return { success: false, error: result.error };
  }

  const result = await createDraftWithToken(token, {
    to: [toEmail],
    subject,
    body: forwardBody,
    isHtml: true,
  });

  if (result.success) {
    return { success: true, draftId: result.draftId };
  }
  return { success: false, error: result.error };
}

/**
 * Build the forwarded message HTML body.
 */
export function buildForwardBody(opts: {
  userHtml: string;
  from: string;
  date: string;
  subject: string;
  to: string;
  originalBody: string;
}): string {
  const parts: string[] = [];

  if (opts.userHtml) {
    parts.push(`<div>${opts.userHtml}</div>`);
    parts.push("<br>");
  }

  parts.push("<div>---------- Forwarded message ---------</div>");
  parts.push(`<div>From: ${escapeHtml(opts.from)}</div>`);
  parts.push(`<div>Date: ${escapeHtml(opts.date)}</div>`);
  parts.push(`<div>Subject: ${escapeHtml(opts.subject)}</div>`);
  parts.push(`<div>To: ${escapeHtml(opts.to)}</div>`);
  parts.push("<br>");

  // Intentionally preserve original HTML when forwarding so formatting/quoted
  // blocks survive round-trip exactly as they appeared in the source thread.
  if (opts.originalBody.includes("<")) {
    parts.push(`<div>${opts.originalBody}</div>`);
  } else {
    parts.push(`<div>${textToHtml(opts.originalBody)}</div>`);
  }

  return parts.join("\n");
}

/**
 * Escape HTML special characters to prevent injection.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
