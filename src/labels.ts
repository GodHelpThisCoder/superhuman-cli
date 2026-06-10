/**
 * Labels Module
 *
 * Functions for managing email labels/folders via direct Gmail/MS Graph API.
 * Supports both Microsoft/Outlook accounts (via MS Graph folders) and Gmail accounts (via Gmail labels).
 */

import type { ConnectionProvider } from "./connection-provider";
import {
  modifyThreadLabels,
  updateMessage,
  listLabelsDirect,
  createLabelDirect,
  searchGmailDirect,
  getConversationMessageIds,
} from "./token-api";

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
 * @param provider - The connection provider
 * @returns Array of labels with id and name
 */
export async function listLabels(provider: ConnectionProvider): Promise<Label[]> {
  const token = await provider.getToken();
  return listLabelsDirect(token);
}

/**
 * Create a new label
 *
 * @param provider - The connection provider
 * @param labelName - The name of the new label (supports `/` for nesting, e.g. "Finance/Taxes")
 * @returns The created label with id and name
 */
export async function createNewLabel(
  provider: ConnectionProvider,
  labelName: string
): Promise<Label> {
  const token = await provider.getToken();

  if (token.isMicrosoft) {
    throw new Error("Creating labels not yet supported for Microsoft accounts.");
  }

  const label = await createLabelDirect(token, labelName);
  if (!label) {
    throw new Error(`Failed to create label "${labelName}". The label may already exist or the name may be invalid.`);
  }

  return label;
}

/**
 * Get labels for a specific thread
 *
 * @param provider - The connection provider
 * @param threadId - The thread ID to get labels for
 * @returns Array of labels on the thread
 */
export async function getThreadLabels(
  provider: ConnectionProvider,
  threadId: string
): Promise<Label[]> {
  const token = await provider.getToken();

  // Get all labels to build name mapping
  const allLabels = await listLabelsDirect(token);
  const labelMap = new Map(allLabels.map((l) => [l.id, l]));

  if (token.isMicrosoft) {
    // For MS Graph, we need to get the message and check its folder
    const messageIds = await getConversationMessageIds(token, threadId);
    if (messageIds.length === 0) {
      return [];
    }

    // MS Graph messages have parentFolderId
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageIds[0]}?$select=parentFolderId`,
      {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      }
    );

    if (!response.ok) {
      return [];
    }

    const msg = JSON.parse(await response.text()) as { parentFolderId?: string };
    const folderId = msg.parentFolderId;
    const folder = labelMap.get(folderId!);

    return folder ? [folder] : [];
  } else {
    // Gmail: Get thread to get labelIds
    const response = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=minimal`,
      {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      }
    );

    if (!response.ok) {
      return [];
    }

    const thread = JSON.parse(await response.text()) as { messages?: Array<{ labelIds?: string[] }> };
    const labelIds = thread.messages?.[0]?.labelIds || [];

    return labelIds.map((id: string) => labelMap.get(id) || { id, name: id });
  }
}

/**
 * Add a label to a thread (server-persisted)
 *
 * @param provider - The connection provider
 * @param threadId - The thread ID to add the label to
 * @param labelId - The label ID to add
 * @returns Result with success status
 */
export async function addLabel(
  provider: ConnectionProvider,
  threadId: string,
  labelId: string
): Promise<LabelResult> {
  try {
    const token = await provider.getToken();

    if (token.isMicrosoft) {
      // Microsoft: Move messages to the folder (label = folder in MS)
      // This is complex because MS Graph doesn't have a direct "add label" concept
      // For folders, adding a label means moving to that folder
      return {
        success: false,
        error: "Adding labels to Microsoft accounts not yet supported via direct API. Use folders instead.",
      };
    } else {
      // Gmail: Add label via threads.modify
      const success = await modifyThreadLabels(token, threadId, [labelId], []);
      return { success };
    }
  } catch (e: any) {
    return { success: false, error: e.message || "Unknown error" };
  }
}

/**
 * Remove a label from a thread (server-persisted)
 *
 * @param provider - The connection provider
 * @param threadId - The thread ID to remove the label from
 * @param labelId - The label ID to remove
 * @returns Result with success status
 */
export async function removeLabel(
  provider: ConnectionProvider,
  threadId: string,
  labelId: string
): Promise<LabelResult> {
  try {
    const token = await provider.getToken();

    if (token.isMicrosoft) {
      return {
        success: false,
        error: "Removing labels from Microsoft accounts not yet supported via direct API.",
      };
    } else {
      // Gmail: Remove label via threads.modify
      const success = await modifyThreadLabels(token, threadId, [], [labelId]);
      return { success };
    }
  } catch (e: any) {
    return { success: false, error: e.message || "Unknown error" };
  }
}

/**
 * Star a thread (adds STARRED label)
 *
 * @param provider - The connection provider
 * @param threadId - The thread ID to star
 * @returns Result with success status
 */
export async function starThread(
  provider: ConnectionProvider,
  threadId: string
): Promise<LabelResult> {
  try {
    const token = await provider.getToken();

    if (token.isMicrosoft) {
      // Microsoft: Flag all messages in the conversation
      const messageIds = await getConversationMessageIds(token, threadId);

      if (messageIds.length === 0) {
        return { success: false, error: "No messages found in conversation" };
      }

      // Flag each message
      for (const msgId of messageIds) {
        await updateMessage(token, msgId, {
          flag: { flagStatus: "flagged" },
        });
      }

      return { success: true };
    } else {
      // Gmail: Add STARRED label
      const success = await modifyThreadLabels(token, threadId, ["STARRED"], []);
      return { success };
    }
  } catch (e: any) {
    return { success: false, error: e.message || "Unknown error" };
  }
}

/**
 * Unstar a thread (removes STARRED label)
 *
 * @param provider - The connection provider
 * @param threadId - The thread ID to unstar
 * @returns Result with success status
 */
export async function unstarThread(
  provider: ConnectionProvider,
  threadId: string
): Promise<LabelResult> {
  try {
    const token = await provider.getToken();

    if (token.isMicrosoft) {
      // Microsoft: Unflag all messages in the conversation
      const messageIds = await getConversationMessageIds(token, threadId);

      if (messageIds.length === 0) {
        return { success: false, error: "No messages found in conversation" };
      }

      // Unflag each message
      for (const msgId of messageIds) {
        await updateMessage(token, msgId, {
          flag: { flagStatus: "notFlagged" },
        });
      }

      return { success: true };
    } else {
      // Gmail: Remove STARRED label
      const success = await modifyThreadLabels(token, threadId, [], ["STARRED"]);
      return { success };
    }
  } catch (e: any) {
    return { success: false, error: e.message || "Unknown error" };
  }
}

/**
 * List all starred threads
 *
 * @param provider - The connection provider
 * @param limit - Maximum number of threads to return (default: 50)
 * @returns Array of starred threads with their IDs
 */
export async function listStarred(
  provider: ConnectionProvider,
  limit: number = 50
): Promise<Array<{ id: string }>> {
  const token = await provider.getToken();

  if (token.isMicrosoft) {
    // MS Graph: Search for flagged messages
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$filter=flag/flagStatus eq 'flagged'&$top=${limit}&$select=conversationId`,
      {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      }
    );

    if (!response.ok) {
      // Throw (don't return empty): an empty return here is
      // indistinguishable from "no starred threads", so a swallowed
      // 401/500 makes the starred tool report an empty list when the real
      // problem is an expired token. A 401 message matches isAuthError.
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `MS Graph API error ${response.status} ${response.statusText}${response.status === 401 ? " Unauthorized" : ""} — ${errorText || "starred lookup failed"}`,
      );
    }

    const result = JSON.parse(await response.text()) as { value?: Array<{ conversationId?: string }> };
    if (!result.value) {
      return [];
    }

    // Get unique conversation IDs
    const conversationIds = new Set<string>();
    for (const msg of result.value) {
      if (msg.conversationId) {
        conversationIds.add(msg.conversationId);
      }
    }

    return Array.from(conversationIds).map((id) => ({ id }));
  } else {
    // Gmail: Search for starred messages. searchGmailDirect throws an
    // isAuthError-matching error on 401 — let it propagate.
    const result = await searchGmailDirect(token, "is:starred", limit);
    return result.threads.map((t) => ({ id: t.id }));
  }
}
