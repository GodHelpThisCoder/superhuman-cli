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
 * @param _threadId - The thread ID (must be the currently open thread; unused as native command uses current thread)
 * @param body - The reply body text
 * @param send - If true, send immediately; if false, save as draft
 * @returns Result with success status and optional draft ID
 */
export async function replyToThread(
  conn: SuperhumanConnection,
  _threadId: string,
  body: string,
  send: boolean = false
): Promise<ReplyResult> {
  const draftKey = await openReplyCompose(conn);
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
 * @param _threadId - The thread ID (must be the currently open thread; unused as native command uses current thread)
 * @param body - The reply body text
 * @param send - If true, send immediately; if false, save as draft
 * @returns Result with success status and optional draft ID
 */
export async function replyAllToThread(
  conn: SuperhumanConnection,
  _threadId: string,
  body: string,
  send: boolean = false
): Promise<ReplyResult> {
  const draftKey = await openReplyAllCompose(conn);
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
 * @param _threadId - The thread ID (must be the currently open thread; unused as native command uses current thread)
 * @param toEmail - The email address to forward to
 * @param body - The message body to include before the forwarded content
 * @param send - If true, send immediately; if false, save as draft
 * @returns Result with success status and optional draft ID
 */
export async function forwardThread(
  conn: SuperhumanConnection,
  _threadId: string,
  toEmail: string,
  body: string,
  send: boolean = false
): Promise<ReplyResult> {
  const draftKey = await openForwardCompose(conn);
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
