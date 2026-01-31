/**
 * Read Status Module
 *
 * Functions for marking email threads as read or unread via Superhuman's internal APIs.
 * Supports both Microsoft/Outlook accounts (via msgraph) and Gmail accounts (via gmail API).
 */

import type { SuperhumanConnection } from "./superhuman-api";

export interface ReadStatusResult {
  success: boolean;
  error?: string;
}

/**
 * Mark a thread as read (server-persisted)
 *
 * For Microsoft accounts: Updates message isRead property via msgraph API
 * For Gmail accounts: Removes UNREAD label via gmail API
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to mark as read
 * @returns Result with success status
 */
export async function markAsRead(
  conn: SuperhumanConnection,
  threadId: string
): Promise<ReadStatusResult> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const threadId = ${JSON.stringify(threadId)};
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) {
            return { success: false, error: "DI container not found" };
          }

          // Get the thread from identity map
          const thread = ga?.threads?.identityMap?.get?.(threadId);
          if (!thread) {
            return { success: false, error: "Thread not found" };
          }

          const model = thread._threadModel;
          if (!model) {
            return { success: false, error: "Thread model not found" };
          }

          // Check if thread is already read (no UNREAD label)
          if (!model.labelIds || !model.labelIds.includes('UNREAD')) {
            // Thread already read - consider this a success
            return { success: true };
          }

          // Check if this is a Microsoft account
          const isMicrosoft = di.get?.('isMicrosoft');

          if (isMicrosoft) {
            // Microsoft account: Use msgraph to update isRead property
            const msgraph = di.get?.('msgraph');
            if (!msgraph) {
              return { success: false, error: "msgraph service not found" };
            }

            // Get message IDs from the thread model
            const messageIds = model.messageIds;
            if (!messageIds || messageIds.length === 0) {
              return { success: false, error: "No messages found in thread" };
            }

            // Try to find the update method on msgraph
            // Common patterns: updateMessage, patchMessage, markAsRead
            if (typeof msgraph.updateMessages === 'function') {
              await msgraph.updateMessages(messageIds.map(id => ({ id, isRead: true })));
            } else if (typeof msgraph.patchMessages === 'function') {
              await msgraph.patchMessages(messageIds.map(id => ({ id, isRead: true })));
            } else if (typeof msgraph.markMessagesAsRead === 'function') {
              await msgraph.markMessagesAsRead(messageIds);
            } else {
              // Fallback: try batch update
              for (const messageId of messageIds) {
                if (typeof msgraph.updateMessage === 'function') {
                  await msgraph.updateMessage(messageId, { isRead: true });
                } else if (typeof msgraph.patchMessage === 'function') {
                  await msgraph.patchMessage(messageId, { isRead: true });
                }
              }
            }
          } else {
            // Gmail account: Use gmail.changeLabelsPerThread to remove UNREAD label
            const gmail = di.get?.('gmail');
            if (!gmail) {
              return { success: false, error: "gmail service not found" };
            }

            // Remove UNREAD label
            await gmail.changeLabelsPerThread(threadId, [], ['UNREAD']);
          }

          // Update local state for immediate UI feedback
          model.labelIds = model.labelIds.filter(l => l !== 'UNREAD');

          // Recalculate list IDs if available
          try {
            thread.recalculateListIds?.();
          } catch (e) {}

          return { success: true };
        } catch (e) {
          return { success: false, error: e.message || "Unknown error" };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result.result.value as { success: boolean; error?: string } | null;
  return { success: value?.success ?? false, error: value?.error };
}

/**
 * Mark a thread as unread (server-persisted)
 *
 * For Microsoft accounts: Updates message isRead property via msgraph API
 * For Gmail accounts: Adds UNREAD label via gmail API
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to mark as unread
 * @returns Result with success status
 */
export async function markAsUnread(
  conn: SuperhumanConnection,
  threadId: string
): Promise<ReadStatusResult> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const threadId = ${JSON.stringify(threadId)};
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) {
            return { success: false, error: "DI container not found" };
          }

          // Get the thread from identity map
          const thread = ga?.threads?.identityMap?.get?.(threadId);
          if (!thread) {
            return { success: false, error: "Thread not found" };
          }

          const model = thread._threadModel;
          if (!model) {
            return { success: false, error: "Thread model not found" };
          }

          // Check if thread is already unread (has UNREAD label)
          if (model.labelIds && model.labelIds.includes('UNREAD')) {
            // Thread already unread - consider this a success
            return { success: true };
          }

          // Check if this is a Microsoft account
          const isMicrosoft = di.get?.('isMicrosoft');

          if (isMicrosoft) {
            // Microsoft account: Use msgraph to update isRead property
            const msgraph = di.get?.('msgraph');
            if (!msgraph) {
              return { success: false, error: "msgraph service not found" };
            }

            // Get message IDs from the thread model
            const messageIds = model.messageIds;
            if (!messageIds || messageIds.length === 0) {
              return { success: false, error: "No messages found in thread" };
            }

            // Try to find the update method on msgraph
            if (typeof msgraph.updateMessages === 'function') {
              await msgraph.updateMessages(messageIds.map(id => ({ id, isRead: false })));
            } else if (typeof msgraph.patchMessages === 'function') {
              await msgraph.patchMessages(messageIds.map(id => ({ id, isRead: false })));
            } else if (typeof msgraph.markMessagesAsUnread === 'function') {
              await msgraph.markMessagesAsUnread(messageIds);
            } else {
              // Fallback: try individual update
              for (const messageId of messageIds) {
                if (typeof msgraph.updateMessage === 'function') {
                  await msgraph.updateMessage(messageId, { isRead: false });
                } else if (typeof msgraph.patchMessage === 'function') {
                  await msgraph.patchMessage(messageId, { isRead: false });
                }
              }
            }
          } else {
            // Gmail account: Use gmail.changeLabelsPerThread to add UNREAD label
            const gmail = di.get?.('gmail');
            if (!gmail) {
              return { success: false, error: "gmail service not found" };
            }

            // Add UNREAD label
            await gmail.changeLabelsPerThread(threadId, ['UNREAD'], []);
          }

          // Update local state for immediate UI feedback
          if (!model.labelIds) {
            model.labelIds = [];
          }
          if (!model.labelIds.includes('UNREAD')) {
            model.labelIds.push('UNREAD');
          }

          // Recalculate list IDs if available
          try {
            thread.recalculateListIds?.();
          } catch (e) {}

          return { success: true };
        } catch (e) {
          return { success: false, error: e.message || "Unknown error" };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result.result.value as { success: boolean; error?: string } | null;
  return { success: value?.success ?? false, error: value?.error };
}
