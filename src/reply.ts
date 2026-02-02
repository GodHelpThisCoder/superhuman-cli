/**
 * Reply Module
 *
 * Functions for replying to email threads via Superhuman's internal APIs.
 * Uses native Superhuman commands for proper email threading.
 */

import type { SuperhumanConnection } from "./superhuman-api.js";
import {
  openReplyCompose,
  openReplyAllCompose,
  openForwardCompose,
  addRecipient,
  setBody,
  saveDraft,
  sendDraft,
  textToHtml,
} from "./superhuman-api.js";

export interface ReplyResult {
  success: boolean;
  draftId?: string;
}

/**
 * Complete a draft by either saving or sending it
 */
async function completeDraft(
  conn: SuperhumanConnection,
  draftKey: string,
  send: boolean
): Promise<ReplyResult> {
  if (send) {
    const sent = await sendDraft(conn);
    return { success: sent };
  }

  const saved = await saveDraft(conn);
  return { success: saved, draftId: draftKey };
}

/**
 * Reply to a thread
 *
 * Uses Superhuman's native REPLY_POP_OUT command which properly sets up
 * threading (threadId, inReplyTo, references), recipients, and subject.
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to reply to
 * @param body - The reply body text
 * @param send - If true, send immediately; if false, save as draft
 * @returns Result with success status and optional draft ID
 */
export async function replyToThread(
  conn: SuperhumanConnection,
  threadId: string,
  body: string,
  send: boolean = false
): Promise<ReplyResult> {
  const draftKey = await openReplyCompose(conn, threadId);
  if (!draftKey) {
    return { success: false };
  }

  const bodySet = await setBody(conn, textToHtml(body));
  if (!bodySet) {
    return { success: false };
  }

  return completeDraft(conn, draftKey, send);
}

/**
 * Reply-all to a thread
 *
 * Uses Superhuman's native REPLY_ALL_POP_OUT command which properly sets up
 * threading (threadId, inReplyTo, references), all recipients (To and Cc),
 * and subject automatically.
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to reply to
 * @param body - The reply body text
 * @param send - If true, send immediately; if false, save as draft
 * @returns Result with success status and optional draft ID
 */
export async function replyAllToThread(
  conn: SuperhumanConnection,
  threadId: string,
  body: string,
  send: boolean = false
): Promise<ReplyResult> {
  const draftKey = await openReplyAllCompose(conn, threadId);
  if (!draftKey) {
    return { success: false };
  }

  const bodySet = await setBody(conn, textToHtml(body));
  if (!bodySet) {
    return { success: false };
  }

  return completeDraft(conn, draftKey, send);
}

/**
 * Forward a thread
 *
 * Uses Superhuman's native FORWARD_POP_OUT command which properly sets up
 * the forwarded message content, subject, and formatting.
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to forward
 * @param toEmail - The email address to forward to
 * @param body - The message body to include before the forwarded content
 * @param send - If true, send immediately; if false, save as draft
 * @returns Result with success status and optional draft ID
 */
export async function forwardThread(
  conn: SuperhumanConnection,
  threadId: string,
  toEmail: string,
  body: string,
  send: boolean = false
): Promise<ReplyResult> {
  const draftKey = await openForwardCompose(conn, threadId);
  if (!draftKey) {
    return { success: false };
  }

  const recipientAdded = await addRecipient(conn, toEmail);
  if (!recipientAdded) {
    return { success: false };
  }

  if (body) {
    const bodySet = await setBody(conn, textToHtml(body));
    if (!bodySet) {
      return { success: false };
    }
  }

  return completeDraft(conn, draftKey, send);
}
