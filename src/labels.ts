/**
 * Labels Module
 *
 * Functions for managing email labels/folders via Superhuman's internal APIs.
 * Supports both Microsoft/Outlook accounts (via msgraph folders) and Gmail accounts (via gmail labels).
 */

import type { SuperhumanConnection } from "./superhuman-api";

export interface Label {
  id: string;
  name: string;
  type?: string;
}

export interface LabelResult {
  success: boolean;
  error?: string;
}

/**
 * List all available labels/folders in the account
 *
 * @param conn - The Superhuman connection
 * @returns Array of labels with id and name
 */
export async function listLabels(conn: SuperhumanConnection): Promise<Label[]> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) {
            return { error: "DI container not found", labels: [] };
          }

          // Check if this is a Microsoft account
          const isMicrosoft = di.get?.('isMicrosoft');

          if (isMicrosoft) {
            // Microsoft account: Get folders via msgraph
            const msgraph = di.get?.('msgraph');
            if (!msgraph) {
              return { error: "msgraph service not found", labels: [] };
            }

            const folders = await msgraph.getAllFolders();
            return {
              labels: (folders || []).map(f => ({
                id: f.id,
                name: f.displayName,
                type: 'folder'
              }))
            };
          } else {
            // Gmail account: Get labels via gmail API
            const gmail = di.get?.('gmail');
            if (!gmail) {
              return { error: "gmail service not found", labels: [] };
            }

            const gmailLabels = await gmail.getLabels();
            return {
              labels: (gmailLabels || []).map(l => ({
                id: l.id,
                name: l.name,
                type: l.type
              }))
            };
          }
        } catch (e) {
          return { error: e.message || "Unknown error", labels: [] };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result.result.value as { labels: Label[]; error?: string } | null;
  return value?.labels ?? [];
}

/**
 * Get labels for a specific thread
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to get labels for
 * @returns Array of labels on the thread
 */
export async function getThreadLabels(
  conn: SuperhumanConnection,
  threadId: string
): Promise<Label[]> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const threadId = ${JSON.stringify(threadId)};
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) {
            return { error: "DI container not found", labels: [] };
          }

          // Get the thread from identity map
          const thread = ga?.threads?.identityMap?.get?.(threadId);
          if (!thread) {
            return { error: "Thread not found", labels: [] };
          }

          const model = thread._threadModel;
          if (!model) {
            return { error: "Thread model not found", labels: [] };
          }

          const labelIds = model.labelIds || [];

          // Check if this is a Microsoft account
          const isMicrosoft = di.get?.('isMicrosoft');

          if (isMicrosoft) {
            // For Microsoft, get folder info for each label ID
            const msgraph = di.get?.('msgraph');
            if (!msgraph) {
              // Return just IDs if we can't get names
              return {
                labels: labelIds.map(id => ({ id, name: id, type: 'folder' }))
              };
            }

            const folders = await msgraph.getAllFolders();
            const folderMap = new Map((folders || []).map(f => [f.id, f]));

            return {
              labels: labelIds.map(id => {
                const folder = folderMap.get(id);
                return {
                  id,
                  name: folder?.displayName || id,
                  type: 'folder'
                };
              })
            };
          } else {
            // Gmail: Get label info from labels service or gmail API
            const labelsService = di.get?.('labels');
            const gmail = di.get?.('gmail');

            let allLabels = [];
            if (gmail) {
              allLabels = await gmail.getLabels() || [];
            }

            const labelMap = new Map(allLabels.map(l => [l.id, l]));

            return {
              labels: labelIds.map(id => {
                const label = labelMap.get(id);
                return {
                  id,
                  name: label?.name || id,
                  type: label?.type
                };
              })
            };
          }
        } catch (e) {
          return { error: e.message || "Unknown error", labels: [] };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result.result.value as { labels: Label[]; error?: string } | null;
  return value?.labels ?? [];
}

/**
 * Add a label to a thread (server-persisted)
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to add the label to
 * @param labelId - The label ID to add
 * @returns Result with success status
 */
export async function addLabel(
  conn: SuperhumanConnection,
  threadId: string,
  labelId: string
): Promise<LabelResult> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const threadId = ${JSON.stringify(threadId)};
          const labelId = ${JSON.stringify(labelId)};
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

          // Check if thread already has this label
          if (model.labelIds && model.labelIds.includes(labelId)) {
            return { success: true }; // Already has the label
          }

          // Check if this is a Microsoft account
          const isMicrosoft = di.get?.('isMicrosoft');

          if (isMicrosoft) {
            // Microsoft account: Move messages to folder (labels are folders in Outlook)
            const msgraph = di.get?.('msgraph');
            if (!msgraph) {
              return { success: false, error: "msgraph service not found" };
            }

            const messageIds = model.messageIds;
            if (!messageIds || messageIds.length === 0) {
              return { success: false, error: "No messages found in thread" };
            }

            // Move messages to the label/folder
            const moveRequests = messageIds.map(messageId => ({
              messageId,
              destinationFolderId: labelId
            }));

            await msgraph.moveMessages(moveRequests);
          } else {
            // Gmail account: Add label via changeLabelsPerThread
            const gmail = di.get?.('gmail');
            if (!gmail) {
              return { success: false, error: "gmail service not found" };
            }

            await gmail.changeLabelsPerThread(threadId, [labelId], []);
          }

          // Update local state
          if (!model.labelIds) {
            model.labelIds = [];
          }
          if (!model.labelIds.includes(labelId)) {
            model.labelIds.push(labelId);
          }

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
 * Remove a label from a thread (server-persisted)
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to remove the label from
 * @param labelId - The label ID to remove
 * @returns Result with success status
 */
export async function removeLabel(
  conn: SuperhumanConnection,
  threadId: string,
  labelId: string
): Promise<LabelResult> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const threadId = ${JSON.stringify(threadId)};
          const labelId = ${JSON.stringify(labelId)};
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

          // Check if thread has this label
          if (!model.labelIds || !model.labelIds.includes(labelId)) {
            return { success: true }; // Already doesn't have the label
          }

          // Check if this is a Microsoft account
          const isMicrosoft = di.get?.('isMicrosoft');

          if (isMicrosoft) {
            // Microsoft: For labels that are categories, we need different handling
            // For folders, removing is more complex - typically move back to inbox
            // For now, return an error as folder-based label removal is complex
            return { success: false, error: "Removing folder labels not yet supported for Microsoft accounts" };
          } else {
            // Gmail account: Remove label via changeLabelsPerThread
            const gmail = di.get?.('gmail');
            if (!gmail) {
              return { success: false, error: "gmail service not found" };
            }

            await gmail.changeLabelsPerThread(threadId, [], [labelId]);
          }

          // Update local state
          model.labelIds = model.labelIds.filter(l => l !== labelId);

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
 * Star a thread (adds STARRED label)
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to star
 * @returns Result with success status
 */
export async function starThread(
  conn: SuperhumanConnection,
  threadId: string
): Promise<LabelResult> {
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

          // Check if thread already has STARRED label
          if (model.labelIds && model.labelIds.includes("STARRED")) {
            return { success: true }; // Already starred
          }

          // Check if this is a Microsoft account
          const isMicrosoft = di.get?.('isMicrosoft');
          if (isMicrosoft) {
            return { success: false, error: "Starring not supported for Microsoft accounts" };
          }

          // Gmail account: Add STARRED label via changeLabelsPerThread
          const gmail = di.get?.('gmail');
          if (!gmail) {
            return { success: false, error: "gmail service not found" };
          }

          await gmail.changeLabelsPerThread(threadId, ["STARRED"], []);

          // Update local state
          if (!model.labelIds) {
            model.labelIds = [];
          }
          if (!model.labelIds.includes("STARRED")) {
            model.labelIds.push("STARRED");
          }

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
 * Unstar a thread (removes STARRED label)
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to unstar
 * @returns Result with success status
 */
export async function unstarThread(
  conn: SuperhumanConnection,
  threadId: string
): Promise<LabelResult> {
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

          // Check if thread has STARRED label
          if (!model.labelIds || !model.labelIds.includes("STARRED")) {
            return { success: true }; // Already not starred
          }

          // Check if this is a Microsoft account
          const isMicrosoft = di.get?.('isMicrosoft');
          if (isMicrosoft) {
            return { success: false, error: "Starring not supported for Microsoft accounts" };
          }

          // Gmail account: Remove STARRED label via changeLabelsPerThread
          const gmail = di.get?.('gmail');
          if (!gmail) {
            return { success: false, error: "gmail service not found" };
          }

          await gmail.changeLabelsPerThread(threadId, [], ["STARRED"]);

          // Update local state
          model.labelIds = model.labelIds.filter(l => l !== "STARRED");

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
 * List all starred threads
 *
 * @param conn - The Superhuman connection
 * @param limit - Maximum number of threads to return (default: 50)
 * @returns Array of starred threads with their IDs
 */
export async function listStarred(
  conn: SuperhumanConnection,
  limit: number = 50
): Promise<Array<{ id: string }>> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) {
            return { error: "DI container not found", threads: [] };
          }

          // Check if this is a Microsoft account
          const isMicrosoft = di.get?.('isMicrosoft');
          if (isMicrosoft) {
            return { error: "Starring not supported for Microsoft accounts", threads: [] };
          }

          // Use portal to list threads with STARRED label
          const response = await ga.portal.invoke(
            "threadInternal",
            "listAsync",
            ["STARRED", { limit: ${limit}, filters: [], query: "" }]
          );

          if (!response?.threads) {
            return { threads: [] };
          }

          return {
            threads: response.threads.map(t => {
              const thread = t.json || t;
              return { id: thread.id };
            })
          };
        } catch (e) {
          return { error: e.message || "Unknown error", threads: [] };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result.result.value as { threads: Array<{ id: string }>; error?: string } | null;
  return value?.threads ?? [];
}
