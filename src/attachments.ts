/**
 * Attachments Module
 *
 * Functions for listing and downloading attachments from Superhuman emails
 * via direct Gmail/MS Graph API.
 */

import type { ConnectionProvider } from "./connection-provider";
import {
  getThreadDirect,
  downloadAttachmentDirect,
  addAttachmentToDraft,
} from "./token-api";

export interface Attachment {
  id: string;
  attachmentId: string;
  name: string;
  mimeType: string;
  extension: string;
  messageId: string;
  threadId: string;
  inline: boolean;
}

export interface AttachmentContent {
  data: string; // base64
  size: number;
}

export interface AddAttachmentResult {
  success: boolean;
  error?: string;
}

/**
 * Extract file extension from filename.
 */
function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * List all attachments from a thread
 */
export async function listAttachments(
  provider: ConnectionProvider,
  threadId: string
): Promise<Attachment[]> {
  const token = await provider.getToken();
  const thread = await getThreadDirect(token, threadId);

  if (!thread) {
    return [];
  }

  const attachments: Attachment[] = [];

  for (const msg of thread.messages) {
    for (const att of msg.attachments) {
      attachments.push({
        id: att.id,
        attachmentId: att.attachmentId,
        name: att.filename,
        mimeType: att.mimeType,
        extension: getExtension(att.filename),
        messageId: att.messageId,
        threadId: threadId,
        inline: false, // Direct API doesn't easily distinguish inline
      });
    }
  }

  return attachments;
}

/**
 * Download attachment content as base64
 * Works for both Gmail and Microsoft accounts
 */
export async function downloadAttachment(
  provider: ConnectionProvider,
  messageId: string,
  attachmentId: string,
  _threadId?: string, // Kept for backward compatibility
  _mimeType?: string  // Kept for backward compatibility
): Promise<AttachmentContent> {
  const token = await provider.getToken();
  return downloadAttachmentDirect(token, messageId, attachmentId);
}

/**
 * Add an attachment to a draft via direct API
 *
 * This function adds attachments to drafts created via the direct API
 * (createDraftGmail/createDraftMsgraph). The draft must exist in the
 * native email provider's Drafts folder.
 *
 * @param provider - The connection provider (for token extraction)
 * @param draftId - The draft ID (Gmail draft ID or MS Graph message ID)
 * @param filename - Name of the file
 * @param base64Data - File content as base64 string
 * @param mimeType - MIME type of the file
 */
export async function addAttachmentDirect(
  provider: ConnectionProvider,
  draftId: string,
  filename: string,
  base64Data: string,
  mimeType: string
): Promise<AddAttachmentResult> {
  try {
    const token = await provider.getToken();
    const success = await addAttachmentToDraft(token, draftId, filename, mimeType, base64Data);
    return { success };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to add attachment" };
  }
}
