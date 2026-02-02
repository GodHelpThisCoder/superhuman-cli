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
  error?: string;
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
    if (!sent) {
      return { success: false, error: "Failed to send draft" };
    }
    return { success: true };
  }

  const saved = await saveDraft(conn);
  if (!saved) {
    return { success: false, error: "Failed to save draft" };
  }
  return { success: true, draftId: draftKey };
}

/**
 * Retry a function with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T | null>,
  maxRetries: number = 3,
  baseDelay: number = 500
): Promise<T | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await fn();
    if (result !== null) {
      return result;
    }
    if (attempt < maxRetries - 1) {
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}

/**
 * Reply to a thread
 *
 * Uses Superhuman's native REPLY_POP_OUT command which properly sets up
 * threading (threadId, inReplyTo, references), recipients, and subject.
 * Includes retry logic for transient UI state failures.
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to reply to
 * @param body - The reply body text
 * @param send - If true, send immediately; if false, save as draft
 * @returns Result with success status, optional draft ID, and error message if failed
 */
export async function replyToThread(
  conn: SuperhumanConnection,
  threadId: string,
  body: string,
  send: boolean = false
): Promise<ReplyResult> {
  // Retry opening compose in case of transient UI state issues
  const draftKey = await withRetry(() => openReplyCompose(conn, threadId), 3, 500);
  if (!draftKey) {
    return {
      success: false,
      error: "Failed to open reply compose (UI may be blocked by existing compose window or overlay)"
    };
  }

  const bodySet = await setBody(conn, textToHtml(body));
  if (!bodySet) {
    return { success: false, error: "Failed to set reply body" };
  }

  return completeDraft(conn, draftKey, send);
}

/**
 * Reply-all to a thread
 *
 * Uses Superhuman's native REPLY_ALL_POP_OUT command which properly sets up
 * threading (threadId, inReplyTo, references), all recipients (To and Cc),
 * and subject automatically. Includes retry logic for transient UI state failures.
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to reply to
 * @param body - The reply body text
 * @param send - If true, send immediately; if false, save as draft
 * @returns Result with success status, optional draft ID, and error message if failed
 */
export async function replyAllToThread(
  conn: SuperhumanConnection,
  threadId: string,
  body: string,
  send: boolean = false
): Promise<ReplyResult> {
  // Retry opening compose in case of transient UI state issues
  const draftKey = await withRetry(() => openReplyAllCompose(conn, threadId), 3, 500);
  if (!draftKey) {
    return {
      success: false,
      error: "Failed to open reply-all compose (UI may be blocked by existing compose window or overlay)"
    };
  }

  const bodySet = await setBody(conn, textToHtml(body));
  if (!bodySet) {
    return { success: false, error: "Failed to set reply body" };
  }

  return completeDraft(conn, draftKey, send);
}

/**
 * Forward a thread
 *
 * Uses Superhuman's native FORWARD_POP_OUT command which properly sets up
 * the forwarded message content, subject, and formatting.
 * Includes retry logic for transient UI state failures.
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to forward
 * @param toEmail - The email address to forward to
 * @param body - The message body to include before the forwarded content
 * @param send - If true, send immediately; if false, save as draft
 * @returns Result with success status, optional draft ID, and error message if failed
 */
export async function forwardThread(
  conn: SuperhumanConnection,
  threadId: string,
  toEmail: string,
  body: string,
  send: boolean = false
): Promise<ReplyResult> {
  // Retry opening compose in case of transient UI state issues
  const draftKey = await withRetry(() => openForwardCompose(conn, threadId), 3, 500);
  if (!draftKey) {
    return {
      success: false,
      error: "Failed to open forward compose (UI may be blocked by existing compose window or overlay)"
    };
  }

  const recipientAdded = await addRecipient(conn, toEmail);
  if (!recipientAdded) {
    return { success: false, error: "Failed to add forward recipient" };
  }

  if (body) {
    const bodySet = await setBody(conn, textToHtml(body));
    if (!bodySet) {
      return { success: false, error: "Failed to set forward body" };
    }
  }

  return completeDraft(conn, draftKey, send);
}
