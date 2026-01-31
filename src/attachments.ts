/**
 * Attachments Module
 *
 * Functions for listing and downloading attachments from Superhuman emails.
 */

import type { SuperhumanConnection } from "./superhuman-api";

export interface Attachment {
  id: string;
  attachmentId: string;
  name: string;
  mimeType: string; // from "type" field
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
 * List all attachments from a thread
 */
export async function listAttachments(
  conn: SuperhumanConnection,
  threadId: string
): Promise<Attachment[]> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const identityMap = window.GoogleAccount?.threads?.identityMap;
          if (!identityMap) return [];

          const thread = identityMap.get(${JSON.stringify(threadId)});
          if (!thread?._threadModel) return [];

          const messages = thread._threadModel.messages || [];
          const allAttachments = [];

          for (const msg of messages) {
            const attachments = msg.attachments || [];
            for (const att of attachments) {
              allAttachments.push({
                id: att.id,
                attachmentId: att.attachmentId,
                name: att.name,
                mimeType: att.type,
                extension: att.extension,
                messageId: att.messageId,
                threadId: att.threadId,
                inline: att.inline
              });
            }
          }

          return allAttachments;
        } catch (e) {
          return [];
        }
      })()
    `,
    returnByValue: true,
  });

  return (result.result.value as Attachment[]) || [];
}

/**
 * Download attachment content as base64
 * Works for both Gmail and Microsoft accounts
 */
export async function downloadAttachment(
  conn: SuperhumanConnection,
  messageId: string,
  attachmentId: string,
  threadId?: string,
  mimeType?: string
): Promise<AttachmentContent> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          // Helper to convert ArrayBuffer to base64
          function arrayBufferToBase64(buffer) {
            const bytes = new Uint8Array(buffer);
            const len = bytes.byteLength;
            // Process in chunks to avoid call stack issues with large files
            const chunkSize = 8192;
            let binary = '';
            for (let i = 0; i < len; i += chunkSize) {
              const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
              binary += String.fromCharCode.apply(null, chunk);
            }
            return btoa(binary);
          }

          // Helper to convert Blob to base64
          async function blobToBase64(blob) {
            const buffer = await blob.arrayBuffer();
            return arrayBufferToBase64(buffer);
          }

          // Try Gmail service first
          const gmail = di?.get?.('gmail');
          if (gmail && typeof gmail.downloadAttachment === 'function') {
            // Gmail downloadAttachment expects: { threadId, messageId, id, type }
            const response = await gmail.downloadAttachment({
              threadId: ${JSON.stringify(threadId || "")},
              messageId: ${JSON.stringify(messageId)},
              id: ${JSON.stringify(attachmentId)},
              type: ${JSON.stringify(mimeType || "")}
            });

            // Check for ArrayBuffer (or ArrayBuffer-like with byteLength)
            if (response && (response instanceof ArrayBuffer || response.byteLength !== undefined)) {
              const base64 = arrayBufferToBase64(response);
              return {
                data: base64,
                size: response.byteLength
              };
            }

            // If response is already a string (base64)
            if (typeof response === 'string') {
              return {
                data: response,
                size: response.length
              };
            }

            // Object with data property
            if (response && response.data) {
              if (response.data instanceof ArrayBuffer || response.data.byteLength !== undefined) {
                const base64 = arrayBufferToBase64(response.data);
                return {
                  data: base64,
                  size: response.data.byteLength
                };
              }
              return {
                data: response.data,
                size: response.size || response.data.length
              };
            }

            // Check for Blob
            if (response instanceof Blob) {
              const base64 = await blobToBase64(response);
              return {
                data: base64,
                size: response.size
              };
            }

            return { error: "Unexpected Gmail response format: " + typeof response };
          }

          // Try Microsoft Graph service
          const msgraph = di?.get?.('msgraph');
          if (msgraph && typeof msgraph.downloadAttachment === 'function') {
            const response = await msgraph.downloadAttachment({
              messageId: ${JSON.stringify(messageId)},
              id: ${JSON.stringify(attachmentId)}
            });

            if (response && (response instanceof ArrayBuffer || response.byteLength !== undefined)) {
              const base64 = arrayBufferToBase64(response);
              return {
                data: base64,
                size: response.byteLength
              };
            }

            if (typeof response === 'string') {
              return {
                data: response,
                size: response.length
              };
            }

            if (response && response.data) {
              if (response.data instanceof ArrayBuffer || response.data.byteLength !== undefined) {
                const base64 = arrayBufferToBase64(response.data);
                return {
                  data: base64,
                  size: response.data.byteLength
                };
              }
              return {
                data: response.data,
                size: response.size || response.data.length
              };
            }

            // Check for Blob
            if (response instanceof Blob) {
              const base64 = await blobToBase64(response);
              return {
                data: base64,
                size: response.size
              };
            }

            return { error: "Unexpected msgraph response format: " + typeof response };
          }

          return { error: "No download service available" };
        } catch (e) {
          return { error: e.message || "Download failed" };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result.result.value as AttachmentContent & { error?: string };

  if (value.error) {
    throw new Error(value.error);
  }

  return {
    data: value.data,
    size: value.size,
  };
}

/**
 * Add an attachment to the current draft
 * @param conn - Superhuman connection
 * @param filename - Name of the file
 * @param base64Data - File content as base64 string
 * @param mimeType - MIME type of the file
 */
export async function addAttachment(
  conn: SuperhumanConnection,
  filename: string,
  base64Data: string,
  mimeType: string
): Promise<AddAttachmentResult> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return { success: false, error: "No compose form controller" };

          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return { success: false, error: "No draft open" };

          const ctrl = cfc[draftKey];
          if (!ctrl) return { success: false, error: "No draft controller" };

          // Convert base64 to Blob
          const base64 = ${JSON.stringify(base64Data)};
          const mimeType = ${JSON.stringify(mimeType)};
          const filename = ${JSON.stringify(filename)};

          const byteCharacters = atob(base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: mimeType });

          // Create a File object
          const file = new File([blob], filename, { type: mimeType });

          // Try using _onAddAttachments
          if (typeof ctrl._onAddAttachments === 'function') {
            await ctrl._onAddAttachments([file]);
            return { success: true };
          }

          // Try using onPasteFile
          if (typeof ctrl.onPasteFile === 'function') {
            await ctrl.onPasteFile(file);
            return { success: true };
          }

          // Try accessing draft directly
          const draft = ctrl?.state?.draft;
          if (draft && typeof draft.addUploads === 'function') {
            await draft.addUploads([file]);
            return { success: true };
          }

          return { success: false, error: "No method available to add attachments" };
        } catch (e) {
          return { success: false, error: e.message || "Failed to add attachment" };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value as AddAttachmentResult;
}
