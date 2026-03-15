/**
 * Gmail & MS Graph Email Operations
 *
 * Extracted from token-api.ts — contains Gmail-specific and dual-provider
 * email operations (search, threads, labels, drafts, send, reply, attachments).
 */

import type {
  TokenInfo,
  AttachmentInfo,
  Label,
  ThreadInfoDirect,
  DraftMessage,
  MimeMessageOptions,
  SendEmailDirectOptions,
  FullThreadMessage,
} from "../auth/types";

import {
  authFetch,
  gmailFetch,
  msgraphFetch,
  GMAIL_API_BASE,
  MSGRAPH_API_BASE,
} from "./http-utils";

import type { InboxThread, SearchResult } from "../inbox";
import type { Contact } from "../contacts";
import { createLogger } from "../logger";

const log = createLogger("gmail-api");

// ============================================================================
// Private API response types
// ============================================================================

/** Gmail API response for messages.list */
interface GmailMessagesListResponse {
  messages?: Array<{
    id: string;
    threadId: string;
  }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/** Gmail API response for drafts.list */
interface GmailDraftsListResponse {
  drafts?: Array<{
    id: string;
    message?: {
      id: string;
      threadId: string;
    };
  }>;
  // Backward-compatible fallback used by existing tests/mocks.
  messages?: Array<{ id: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/** Gmail API response for threads.get (metadata format) */
interface GmailThreadResponse {
  id: string;
  historyId: string;
  messages: Array<{
    id: string;
    threadId: string;
    labelIds: string[];
    snippet: string;
    payload: {
      headers: Array<{
        name: string;
        value: string;
      }>;
    };
    internalDate: string;
  }>;
}

/** Microsoft Graph API response for messages search */
interface MSGraphMessagesResponse {
  value: Array<{
    id: string;
    conversationId: string;
    subject: string;
    from: {
      emailAddress: {
        name: string;
        address: string;
      };
    };
    receivedDateTime: string;
    bodyPreview: string;
  }>;
  "@odata.nextLink"?: string;
}

/** Gmail thread response with full message details */
interface GmailThreadFullResponse {
  id: string;
  historyId: string;
  messages: Array<{
    id: string;
    threadId: string;
    labelIds: string[];
    snippet: string;
    payload: {
      mimeType?: string;
      filename?: string;
      headers: Array<{ name: string; value: string }>;
      parts?: Array<{
        partId: string;
        mimeType: string;
        filename?: string;
        body?: {
          attachmentId?: string;
          size?: number;
          data?: string;
        };
        parts?: any[];
      }>;
      body?: {
        attachmentId?: string;
        size?: number;
        data?: string;
      };
    };
    internalDate: string;
  }>;
}

function sanitizeMimeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function sanitizeMimeFilename(filename: string): string {
  return sanitizeMimeHeaderValue(filename).replace(/"/g, "");
}

export function escapeODataStringLiteral(value: string): string {
  // Remove control chars and escape single quotes for OData string literals.
  return value.replace(/[\u0000-\u001F\u007F]/g, "").replace(/'/g, "''");
}

async function listGmailDraftRefs(
  accessToken: string,
  limit: number,
  offset: number,
): Promise<Array<{ id: string }>> {
  if (limit <= 0) {
    return [];
  }

  let pageToken: string | undefined;
  let toSkip = Math.max(0, offset);
  const selected: Array<{ id: string }> = [];

  while (selected.length < limit) {
    const remaining = limit - selected.length;
    const pageSize = Math.min(500, Math.max(remaining + toSkip, remaining));
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const path = `/drafts?maxResults=${pageSize}${tokenParam}`;
    const page = await gmailFetch(accessToken, path) as GmailDraftsListResponse | null;

    const pageDrafts = (page?.drafts ?? page?.messages ?? []).map((draft) => ({ id: draft.id }));
    if (pageDrafts.length === 0) {
      break;
    }

    if (toSkip >= pageDrafts.length) {
      toSkip -= pageDrafts.length;
    } else {
      const start = toSkip;
      selected.push(...pageDrafts.slice(start, start + remaining));
      toSkip = 0;
    }

    if (!page?.nextPageToken) {
      break;
    }
    pageToken = page.nextPageToken;
  }

  return selected;
}

async function msgraphFetchNextLink(accessToken: string, nextLink: string): Promise<any | null> {
  if (nextLink.startsWith(MSGRAPH_API_BASE)) {
    return msgraphFetch(accessToken, nextLink.slice(MSGRAPH_API_BASE.length));
  }
  return authFetch(nextLink, accessToken);
}

async function fetchMsGraphConversationMessages(
  token: TokenInfo,
  threadId: string,
  selectFields: string,
): Promise<any[]> {
  const MAX_FILTERED_MESSAGES = 500;
  const safeThreadId = escapeODataStringLiteral(threadId);
  const filteredPath =
    `/me/messages?$filter=conversationId eq '${safeThreadId}'` +
    `&$select=${selectFields}&$orderby=receivedDateTime desc&$top=50`;

  try {
    const filteredMatches: any[] = [];
    let nextFilteredPath = filteredPath;
    let scannedFiltered = 0;

    while (nextFilteredPath && scannedFiltered < MAX_FILTERED_MESSAGES) {
      const filtered = nextFilteredPath.startsWith("http")
        ? await msgraphFetchNextLink(token.accessToken, nextFilteredPath)
        : await msgraphFetch(token.accessToken, nextFilteredPath);

      const page = Array.isArray(filtered?.value) ? filtered.value : [];
      if (page.length === 0) {
        break;
      }

      filteredMatches.push(...page);
      scannedFiltered += page.length;
      nextFilteredPath = filtered?.["@odata.nextLink"] || "";
    }

    return filteredMatches;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes("InefficientFilter")) {
      throw error;
    }
  }

  const MAX_SCAN_MESSAGES = 500;
  let scanned = 0;
  let nextPath = `/me/messages?$select=${selectFields}&$top=50&$orderby=receivedDateTime desc`;
  const matches: any[] = [];

  while (nextPath && scanned < MAX_SCAN_MESSAGES) {
    const result = nextPath.startsWith("http")
      ? await msgraphFetchNextLink(token.accessToken, nextPath)
      : await msgraphFetch(token.accessToken, nextPath);

    const page = Array.isArray(result?.value) ? result.value : [];
    if (page.length === 0) {
      break;
    }

    scanned += page.length;
    matches.push(...page.filter((m: any) => m.conversationId === threadId));

    nextPath = result?.["@odata.nextLink"] || "";
  }

  return matches;
}

// ============================================================================
// Search
// ============================================================================

/**
 * Search emails using direct Gmail/MS Graph API.
 *
 * This bypasses Superhuman's search which ignores the query parameter.
 * Uses Gmail's messages.list with q parameter or MS Graph's search endpoint.
 *
 * @param token - Token info with accessToken and isMicrosoft flag
 * @param query - Gmail search query (e.g., "from:anthropic", "subject:meeting")
 * @param limit - Maximum results (default 10)
 * @returns SearchResult containing threads array and optional totalResults count
 */
export async function searchGmail(
  token: TokenInfo,
  query: string,
  limit: number = 10
): Promise<SearchResult> {
  if (token.isMicrosoft) {
    return searchMSGraph(token, query, limit);
  }

  // Step 1: Search for messages matching the query
  const searchPath = `/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`;
  const searchResult = await gmailFetch(token.accessToken, searchPath) as GmailMessagesListResponse | null;

  if (!searchResult || !searchResult.messages || searchResult.messages.length === 0) {
    return { threads: [], totalResults: searchResult?.resultSizeEstimate };
  }

  // Capture totalResults from Gmail's resultSizeEstimate (approximate)
  const totalResults = searchResult.resultSizeEstimate;

  // Step 2: Get unique thread IDs (multiple messages may belong to same thread)
  const threadIdSet = new Set(searchResult.messages.map(m => m.threadId));
  const threadIds = Array.from(threadIdSet);

  // Step 3: Fetch thread details for each unique thread
  const threads: InboxThread[] = [];

  for (const threadId of threadIds.slice(0, limit)) {
    const threadPath = `/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
    const threadResult = await gmailFetch(token.accessToken, threadPath) as GmailThreadResponse | null;

    if (!threadResult || !threadResult.messages || threadResult.messages.length === 0) {
      continue;
    }

    // Get the last message in the thread for display
    const lastMessage = threadResult.messages[threadResult.messages.length - 1]!;
    const headers = lastMessage.payload.headers;

    // Extract headers
    const subjectHeader = headers.find(h => h.name.toLowerCase() === "subject");
    const fromHeader = headers.find(h => h.name.toLowerCase() === "from");
    const dateHeader = headers.find(h => h.name.toLowerCase() === "date");

    // Parse the From header (format: "Name <email>" or just "email")
    const fromValue = fromHeader?.value || "";
    const fromMatch = fromValue.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+)>?$/);
    const fromName = fromMatch?.[1]?.trim() || "";
    const fromEmail = fromMatch?.[2]?.trim() || fromValue;

    threads.push({
      id: threadResult.id,
      subject: subjectHeader?.value || "(no subject)",
      from: {
        email: fromEmail,
        name: fromName,
      },
      date: dateHeader?.value || new Date(parseInt(lastMessage.internalDate)).toISOString(),
      snippet: lastMessage.snippet || "",
      labelIds: lastMessage.labelIds || [],
      messageCount: threadResult.messages.length,
    });
  }

  return { threads, totalResults };
}

/**
 * Search emails using MS Graph API (for Microsoft accounts).
 *
 * @param token - Token info with accessToken
 * @param query - Search query
 * @param limit - Maximum results
 * @returns SearchResult containing threads array and optional totalResults count
 */
export async function searchMSGraph(
  token: TokenInfo,
  query: string,
  limit: number
): Promise<SearchResult> {
  // MS Graph uses $search for full-text search
  const searchPath = `/me/messages?$search="${encodeURIComponent(query)}"&$top=${limit}&$select=id,conversationId,subject,from,receivedDateTime,bodyPreview`;
  const result = await msgraphFetch(token.accessToken, searchPath) as MSGraphMessagesResponse | null;

  if (!result || !result.value || result.value.length === 0) {
    return { threads: [] };
  }

  // Group messages by conversationId (MS Graph's equivalent of threadId)
  const conversationMap = new Map<string, typeof result.value>();

  for (const message of result.value) {
    const existing = conversationMap.get(message.conversationId);
    if (!existing) {
      conversationMap.set(message.conversationId, [message]);
    } else {
      existing.push(message);
    }
  }

  const threads: InboxThread[] = [];

  const conversationEntries = Array.from(conversationMap.entries());
  for (const [conversationId, messages] of conversationEntries) {
    // Sort by date descending and get the latest
    messages.sort((a, b) =>
      new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
    );
    const latestMessage = messages[0]!;

    threads.push({
      id: conversationId,
      subject: latestMessage.subject || "(no subject)",
      from: {
        email: latestMessage.from?.emailAddress?.address || "",
        name: latestMessage.from?.emailAddress?.name || "",
      },
      date: latestMessage.receivedDateTime,
      snippet: latestMessage.bodyPreview || "",
      labelIds: [], // MS Graph doesn't have labelIds in the same way
      messageCount: messages.length,
    });

    if (threads.length >= limit) {
      break;
    }
  }

  // MS Graph doesn't provide a totalResults equivalent for $search
  return { threads };
}

// ============================================================================
// Labels & Folders
// ============================================================================

/**
 * Modify labels on a Gmail thread (add/remove labels).
 *
 * @param token - Token info with accessToken
 * @param threadId - The Gmail thread ID
 * @param addLabelIds - Label IDs to add
 * @param removeLabelIds - Label IDs to remove
 * @returns true on success
 */
export async function modifyThreadLabels(
  token: TokenInfo,
  threadId: string,
  addLabelIds: string[],
  removeLabelIds: string[]
): Promise<boolean> {
  if (token.isMicrosoft) {
    throw new Error("modifyThreadLabels is Gmail-only. Use updateMessage for MS Graph.");
  }

  const path = `/threads/${threadId}/modify`;
  const body = {
    addLabelIds,
    removeLabelIds,
  };

  const result = await gmailFetch(token.accessToken, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return result !== null;
}

/**
 * Update message properties via MS Graph (isRead, flag, etc.).
 *
 * @param token - Token info with accessToken
 * @param messageId - The MS Graph message ID
 * @param updates - Properties to update
 * @returns true on success
 */
export async function updateMessage(
  token: TokenInfo,
  messageId: string,
  updates: { isRead?: boolean; flag?: { flagStatus: string } }
): Promise<boolean> {
  if (!token.isMicrosoft) {
    throw new Error("updateMessage is MS Graph-only. Use modifyThreadLabels for Gmail.");
  }

  const path = `/me/messages/${messageId}`;
  const result = await msgraphFetch(token.accessToken, path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

  return result !== null;
}

/**
 * Move a message to a folder via MS Graph.
 *
 * @param token - Token info with accessToken
 * @param messageId - The MS Graph message ID
 * @param destinationFolderId - The target folder ID
 * @returns true on success
 */
export async function moveMessageToFolder(
  token: TokenInfo,
  messageId: string,
  destinationFolderId: string
): Promise<boolean> {
  if (!token.isMicrosoft) {
    throw new Error("moveMessageToFolder is MS Graph-only. Use modifyThreadLabels for Gmail.");
  }

  const path = `/me/messages/${messageId}/move`;
  const result = await msgraphFetch(token.accessToken, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destinationId: destinationFolderId }),
  });

  return result !== null;
}

/**
 * List all labels (Gmail) or mail folders (MS Graph).
 *
 * @param token - Token info with accessToken and isMicrosoft flag
 * @returns Array of labels/folders
 */
export async function listLabels(token: TokenInfo): Promise<Label[]> {
  if (token.isMicrosoft) {
    // MS Graph: List mail folders
    const result = await msgraphFetch(token.accessToken, "/me/mailFolders?$top=100");

    if (!result || !result.value) {
      return [];
    }

    return result.value.map((f: any) => ({
      id: f.id,
      name: f.displayName,
      type: "folder",
    }));
  } else {
    // Gmail: List labels
    const result = await gmailFetch(token.accessToken, "/labels");

    if (!result || !result.labels) {
      return [];
    }

    return result.labels.map((l: any) => ({
      id: l.id,
      name: l.name,
      type: l.type,
    }));
  }
}

/**
 * Get a specific folder by well-known name (MS Graph).
 *
 * @param token - Token info
 * @param wellKnownName - e.g., "archive", "deleteditems", "inbox"
 * @returns Folder info or null
 */
export async function getWellKnownFolder(
  token: TokenInfo,
  wellKnownName: string
): Promise<{ id: string; displayName: string } | null> {
  if (!token.isMicrosoft) {
    return null;
  }

  const result = await msgraphFetch(token.accessToken, `/me/mailFolders/${wellKnownName}`);
  if (!result) {
    return null;
  }

  return {
    id: result.id,
    displayName: result.displayName,
  };
}

// ============================================================================
// Inbox & Threads
// ============================================================================

/**
 * List inbox threads directly via Gmail/MS Graph API.
 *
 * @param token - Token info
 * @param limit - Maximum threads to return
 * @returns Array of InboxThread
 */
export async function listInbox(
  token: TokenInfo,
  limit: number = 10
): Promise<InboxThread[]> {
  if (token.isMicrosoft) {
    // MS Graph: Get messages from Inbox folder
    const path = `/me/mailFolders/Inbox/messages?$top=${limit}&$select=id,conversationId,subject,from,receivedDateTime,bodyPreview,isRead`;
    const result = await msgraphFetch(token.accessToken, path);

    if (!result || !result.value) {
      return [];
    }

    // Group by conversationId
    const conversationMap = new Map<string, any[]>();
    for (const msg of result.value) {
      const existing = conversationMap.get(msg.conversationId);
      if (!existing) {
        conversationMap.set(msg.conversationId, [msg]);
      } else {
        existing.push(msg);
      }
    }

    const threads: InboxThread[] = [];
    const convEntries = Array.from(conversationMap.entries());
    for (const [convId, messages] of convEntries) {
      messages.sort((a, b) =>
        new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
      );
      const latest = messages[0];

      threads.push({
        id: convId,
        subject: latest.subject || "(no subject)",
        from: {
          email: latest.from?.emailAddress?.address || "",
          name: latest.from?.emailAddress?.name || "",
        },
        date: latest.receivedDateTime,
        snippet: latest.bodyPreview || "",
        labelIds: latest.isRead ? [] : ["UNREAD"],
        messageCount: messages.length,
      });

      if (threads.length >= limit) break;
    }

    return threads;
  } else {
    // Gmail: Search for inbox messages
    const result = await searchGmail(token, "label:INBOX", limit);
    return result.threads;
  }
}

/**
 * Extract attachment info from a Gmail message payload.
 */
function extractAttachments(message: GmailThreadFullResponse["messages"][0]): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];

  function processParts(parts: any[] | undefined, messageId: string) {
    if (!parts) return;

    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || "application/octet-stream",
          size: part.body.size || 0,
          messageId,
        });
      }

      // Recurse into nested parts
      if (part.parts) {
        processParts(part.parts, messageId);
      }
    }
  }

  // Check top-level body
  if (message.payload.body?.attachmentId && message.payload.filename) {
    attachments.push({
      id: message.payload.body.attachmentId,
      attachmentId: message.payload.body.attachmentId,
      filename: message.payload.filename || "attachment",
      mimeType: message.payload.mimeType || "application/octet-stream",
      size: message.payload.body.size || 0,
      messageId: message.id,
    });
  }

  // Process parts
  processParts(message.payload.parts, message.id);

  return attachments;
}

/**
 * Get a Gmail thread with full message details including attachments.
 *
 * @param token - Token info
 * @param threadId - The thread ID
 * @returns Thread with messages and attachment info
 */
export async function getThread(
  token: TokenInfo,
  threadId: string
): Promise<{
  id: string;
  messages: Array<{
    id: string;
    labelIds: string[];
    attachments: AttachmentInfo[];
  }>;
} | null> {
  if (token.isMicrosoft) {
    // MS Graph: Get conversation messages
    const safeThreadId = escapeODataStringLiteral(threadId);
    const path = `/me/messages?$filter=conversationId eq '${safeThreadId}'&$select=id,hasAttachments&$expand=attachments`;
    const result = await msgraphFetch(token.accessToken, path);

    if (!result || !result.value) {
      return null;
    }

    return {
      id: threadId,
      messages: result.value.map((msg: any) => ({
        id: msg.id,
        labelIds: [],
        attachments: (msg.attachments || []).map((att: any) => ({
          id: att.id,
          attachmentId: att.id,
          filename: att.name,
          mimeType: att.contentType,
          size: att.size || 0,
          messageId: msg.id,
        })),
      })),
    };
  } else {
    // Gmail: Get thread with full format
    const path = `/threads/${threadId}?format=full`;
    const result = await gmailFetch(token.accessToken, path) as GmailThreadFullResponse | null;

    if (!result || !result.messages) {
      return null;
    }

    return {
      id: result.id,
      messages: result.messages.map((msg) => ({
        id: msg.id,
        labelIds: msg.labelIds || [],
        attachments: extractAttachments(msg),
      })),
    };
  }
}

// ============================================================================
// Attachments
// ============================================================================

/**
 * Download an attachment from Gmail or MS Graph.
 *
 * @param token - Token info
 * @param messageId - The message ID containing the attachment
 * @param attachmentId - The attachment ID
 * @returns Base64-encoded attachment data and size
 */
export async function downloadAttachment(
  token: TokenInfo,
  messageId: string,
  attachmentId: string
): Promise<{ data: string; size: number }> {
  if (token.isMicrosoft) {
    // MS Graph: Get attachment content
    const path = `/me/messages/${messageId}/attachments/${attachmentId}`;
    const result = await msgraphFetch(token.accessToken, path);

    if (!result) {
      throw new Error("Failed to download attachment");
    }

    // MS Graph returns contentBytes as base64
    return {
      data: result.contentBytes || "",
      size: result.size || 0,
    };
  } else {
    // Gmail: Get attachment
    const path = `/messages/${messageId}/attachments/${attachmentId}`;
    const result = await gmailFetch(token.accessToken, path);

    if (!result) {
      throw new Error("Failed to download attachment");
    }

    // Gmail returns data as URL-safe base64, need to convert
    const urlSafeBase64 = result.data || "";
    // Convert URL-safe base64 to standard base64
    const standardBase64 = urlSafeBase64
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    return {
      data: standardBase64,
      size: result.size || 0,
    };
  }
}

/**
 * Get message IDs for a conversation (MS Graph helper).
 * MS Graph operations work on messages, not threads/conversations.
 *
 * @param token - Token info
 * @param conversationId - The conversation ID
 * @returns Array of message IDs
 */
export async function getConversationMessageIds(
  token: TokenInfo,
  conversationId: string
): Promise<string[]> {
  if (!token.isMicrosoft) {
    throw new Error("getConversationMessageIds is MS Graph-only");
  }

  const safeConversationId = escapeODataStringLiteral(conversationId);
  const path = `/me/messages?$filter=conversationId eq '${safeConversationId}'&$select=id`;
  const result = await msgraphFetch(token.accessToken, path);

  if (!result || !result.value) {
    return [];
  }

  return result.value.map((m: any) => m.id);
}

/**
 * Add an attachment to a draft via MS Graph API.
 *
 * @param token - Token info
 * @param draftId - The draft/message ID
 * @param filename - Attachment filename
 * @param contentType - MIME type
 * @param base64Data - Base64-encoded attachment data
 * @returns true on success
 */
export async function addAttachmentToMsgraphDraft(
  token: TokenInfo,
  draftId: string,
  filename: string,
  contentType: string,
  base64Data: string
): Promise<boolean> {
  if (!token.isMicrosoft) {
    throw new Error("addAttachmentToMsgraphDraft is MS Graph-only");
  }

  const path = `/me/messages/${draftId}/attachments`;
  const body = {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: filename,
    contentType: contentType,
    contentBytes: base64Data,
  };

  const result = await msgraphFetch(token.accessToken, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return result !== null;
}

/**
 * Add an attachment to a Gmail draft.
 *
 * Gmail requires rebuilding the entire MIME message with attachments.
 * This function fetches the draft, adds the attachment, and updates it.
 *
 * @param token - Token info
 * @param draftId - The Gmail draft ID
 * @param filename - Attachment filename
 * @param contentType - MIME type
 * @param base64Data - Base64-encoded attachment data
 * @returns true on success
 */
export async function addAttachmentToGmailDraft(
  token: TokenInfo,
  draftId: string,
  filename: string,
  contentType: string,
  base64Data: string
): Promise<boolean> {
  if (token.isMicrosoft) {
    throw new Error("addAttachmentToGmailDraft is Gmail-only");
  }

  // Step 1: Get the existing draft
  const draftPath = `/drafts/${draftId}?format=full`;
  const draft = await gmailFetch(token.accessToken, draftPath);

  if (!draft || !draft.message) {
    throw new Error("Draft not found");
  }

  // Step 2: Extract existing message content
  const message = draft.message;
  const payload = message.payload;
  const headers = payload.headers || [];

  // Helper to get header value
  const getHeader = (name: string) =>
    headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

  const to = getHeader("To");
  const cc = getHeader("Cc");
  const bcc = getHeader("Bcc");
  const subject = getHeader("Subject");
  const from = getHeader("From");
  const inReplyTo = getHeader("In-Reply-To");
  const references = getHeader("References");

  // Extract body from the message
  let body = "";
  let isHtml = false;

  function extractBody(part: any): void {
    if (part.mimeType === "text/html" && part.body?.data) {
      body = Buffer.from(part.body.data, "base64url").toString("utf-8");
      isHtml = true;
    } else if (part.mimeType === "text/plain" && part.body?.data && !body) {
      body = Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    if (part.parts) {
      for (const p of part.parts) {
        extractBody(p);
      }
    }
  }
  extractBody(payload);

  // Collect existing attachments
  const existingAttachments: Array<{
    filename: string;
    mimeType: string;
    data: string;
  }> = [];

  async function collectAttachments(part: any): Promise<void> {
    if (part.filename && part.body?.attachmentId) {
      // Fetch the attachment data
      const attPath = `/messages/${message.id}/attachments/${part.body.attachmentId}`;
      const attData = await gmailFetch(token.accessToken, attPath);
      if (attData?.data) {
        existingAttachments.push({
          filename: part.filename,
          mimeType: part.mimeType || "application/octet-stream",
          data: attData.data.replace(/-/g, "+").replace(/_/g, "/"),
        });
      }
    }
    if (part.parts) {
      for (const p of part.parts) {
        await collectAttachments(p);
      }
    }
  }
  await collectAttachments(payload);

  // Add the new attachment
  existingAttachments.push({
    filename,
    mimeType: contentType,
    data: base64Data,
  });

  // Step 3: Build new MIME message with attachments
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const mimeHeaders = [
    "MIME-Version: 1.0",
    `From: ${sanitizeMimeHeaderValue(from)}`,
    `To: ${sanitizeMimeHeaderValue(to)}`,
  ];

  if (cc) mimeHeaders.push(`Cc: ${sanitizeMimeHeaderValue(cc)}`);
  if (bcc) mimeHeaders.push(`Bcc: ${sanitizeMimeHeaderValue(bcc)}`);
  mimeHeaders.push(`Subject: ${sanitizeMimeHeaderValue(subject)}`);
  if (inReplyTo) mimeHeaders.push(`In-Reply-To: ${sanitizeMimeHeaderValue(inReplyTo)}`);
  if (references) mimeHeaders.push(`References: ${sanitizeMimeHeaderValue(references)}`);
  mimeHeaders.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  mimeHeaders.push("");

  // Body part
  const bodyPart = [
    `--${boundary}`,
    `Content-Type: ${isHtml ? "text/html" : "text/plain"}; charset=utf-8`,
    "",
    body,
  ].join("\r\n");

  // Attachment parts
  const attachmentParts = existingAttachments.map((att) => {
    const safeFilename = sanitizeMimeFilename(att.filename);
    return [
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${safeFilename}"`,
      `Content-Disposition: attachment; filename="${safeFilename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      att.data,
    ].join("\r\n");
  }).join("\r\n");

  const fullMessage = [
    mimeHeaders.join("\r\n"),
    bodyPart,
    attachmentParts,
    `--${boundary}--`,
  ].join("\r\n");

  // Base64url encode
  const base64Message = Buffer.from(fullMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // Step 4: Update the draft
  const updatePath = `/drafts/${draftId}`;
  const updateBody: any = {
    message: { raw: base64Message },
  };

  if (message.threadId) {
    updateBody.message.threadId = message.threadId;
  }

  const response = await fetch(
    `${GMAIL_API_BASE}${updatePath}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateBody),
    }
  );

  return response.ok;
}

/**
 * Add an attachment to a draft (Gmail or MS Graph).
 *
 * @param token - Token info
 * @param draftId - The draft ID
 * @param filename - Attachment filename
 * @param contentType - MIME type
 * @param base64Data - Base64-encoded attachment data
 * @returns true on success
 */
export async function addAttachmentToDraft(
  token: TokenInfo,
  draftId: string,
  filename: string,
  contentType: string,
  base64Data: string
): Promise<boolean> {
  if (token.isMicrosoft) {
    return addAttachmentToMsgraphDraft(token, draftId, filename, contentType, base64Data);
  } else {
    return addAttachmentToGmailDraft(token, draftId, filename, contentType, base64Data);
  }
}

// ============================================================================
// MIME Message Building
// ============================================================================

/**
 * Build an RFC 2822 MIME message and return it base64url encoded.
 * This is the format required by Gmail API for sending/creating drafts.
 */
export function buildMimeMessage(options: MimeMessageOptions): string {
  const sanitizedFrom = sanitizeMimeHeaderValue(options.from);
  const sanitizedTo = options.to.map((recipient) => sanitizeMimeHeaderValue(recipient));
  const sanitizedCc = options.cc?.map((recipient) => sanitizeMimeHeaderValue(recipient));
  const sanitizedBcc = options.bcc?.map((recipient) => sanitizeMimeHeaderValue(recipient));
  const sanitizedSubject = sanitizeMimeHeaderValue(options.subject);

  const headers: string[] = [
    "MIME-Version: 1.0",
    `From: ${sanitizedFrom}`,
    `To: ${sanitizedTo.join(", ")}`,
  ];

  if (sanitizedCc && sanitizedCc.length > 0) {
    headers.push(`Cc: ${sanitizedCc.join(", ")}`);
  }

  if (sanitizedBcc && sanitizedBcc.length > 0) {
    headers.push(`Bcc: ${sanitizedBcc.join(", ")}`);
  }

  headers.push(`Subject: ${sanitizedSubject}`);

  // Content type based on whether body is HTML
  if (options.isHtml !== false) {
    headers.push("Content-Type: text/html; charset=utf-8");
  } else {
    headers.push("Content-Type: text/plain; charset=utf-8");
  }

  // Add threading headers for replies
  if (options.inReplyTo) {
    // Ensure Message-ID format with angle brackets
    const sanitizedReplyTo = sanitizeMimeHeaderValue(options.inReplyTo);
    const formattedReplyTo = sanitizedReplyTo.startsWith("<")
      ? sanitizedReplyTo
      : `<${sanitizedReplyTo}>`;
    headers.push(`In-Reply-To: ${formattedReplyTo}`);
  }

  if (options.references && options.references.length > 0) {
    // Format references with angle brackets if needed
    const formattedRefs = options.references
      .map((r) => sanitizeMimeHeaderValue(r))
      .map((r) => (r.startsWith("<") ? r : `<${r}>`))
      .join(" ");
    headers.push(`References: ${formattedRefs}`);
  }

  // Add empty line separator and body
  headers.push("");
  headers.push(options.body);

  const rawEmail = headers.join("\r\n");

  // Base64url encode the email
  const base64Email = Buffer.from(rawEmail)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return base64Email;
}

// ============================================================================
// Thread Info
// ============================================================================

/**
 * Get thread information for composing a reply via direct API.
 * Fetches the thread and extracts headers needed for proper threading.
 *
 * @param token - Token info
 * @param threadId - The thread ID to get info for
 * @returns Thread info or null if not found
 */
export async function getThreadInfo(
  token: TokenInfo,
  threadId: string
): Promise<ThreadInfoDirect | null> {
  if (token.isMicrosoft) {
    // Prefer server-side conversationId filter, but fall back to pagination when
    // Graph rejects it with "InefficientFilter".
    const selectFields = "id,subject,from,toRecipients,ccRecipients,internetMessageHeaders,receivedDateTime,conversationId";
    let messages = await fetchMsGraphConversationMessages(token, threadId, selectFields);

    // Fallback: threadId might be a message ID, not a conversationId
    // (matches pattern in getThreadMessagesMsGraph and readThreadMSGraph)
    if (messages.length === 0) {
      try {
        const msg = await msgraphFetch(
          token.accessToken,
          `/me/messages/${threadId}?$select=${selectFields}`
        );
        if (msg) {
          messages = [msg];
        }
      } catch (error) {
        log.error(`MS Graph message ID fallback: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (messages.length === 0) {
      return null;
    }

    // Sort descending by date and take the latest
    messages.sort((a: any, b: any) =>
      new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
    );
    const lastMessage = messages[0];

    // Extract Message-ID from internet message headers
    let messageId: string | null = null;
    const references: string[] = [];

    if (lastMessage.internetMessageHeaders) {
      for (const header of lastMessage.internetMessageHeaders) {
        if (header.name.toLowerCase() === "message-id") {
          messageId = header.value;
        } else if (header.name.toLowerCase() === "references") {
          references.push(...header.value.split(/\s+/).filter(Boolean));
        }
      }
    }

    // Add the last message ID to references if available
    if (messageId && !references.includes(messageId)) {
      references.push(messageId);
    }

    return {
      messageId,
      references,
      subject: lastMessage.subject || "",
      from: lastMessage.from?.emailAddress?.address || "",
      to: (lastMessage.toRecipients || []).map((r: any) => r.emailAddress?.address || "").filter(Boolean),
      cc: (lastMessage.ccRecipients || []).map((r: any) => r.emailAddress?.address || "").filter(Boolean),
    };
  } else {
    // Gmail: Get thread with full format to access headers
    const path = `/threads/${threadId}?format=full`;
    const result = await gmailFetch(token.accessToken, path);

    if (!result || !result.messages || result.messages.length === 0) {
      return null;
    }

    // Get the last message
    const lastMessage = result.messages[result.messages.length - 1];
    const headers = lastMessage.payload?.headers || [];

    // Helper to get header value
    const getHeader = (name: string): string => {
      const header = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
      return header?.value || "";
    };

    // Extract Message-ID and References
    const messageId = getHeader("Message-ID") || getHeader("Message-Id") || null;
    const referencesStr = getHeader("References");
    const references = referencesStr ? referencesStr.split(/\s+/).filter(Boolean) : [];

    // Add the last message ID to references if available
    if (messageId && !references.includes(messageId)) {
      references.push(messageId);
    }

    // Parse From header (format: "Name <email>" or just "email")
    const fromHeader = getHeader("From");
    const fromMatch = fromHeader.match(/<([^>]+)>/) || [null, fromHeader];
    const from = fromMatch[1] || fromHeader;

    // Parse To and Cc headers
    const parseRecipients = (header: string): string[] => {
      if (!header) return [];
      return header
        .split(",")
        .map((r) => {
          const match = r.match(/<([^>]+)>/) || [null, r.trim()];
          return match[1] || r.trim();
        })
        .filter(Boolean);
    };

    return {
      messageId,
      references,
      subject: getHeader("Subject"),
      from,
      to: parseRecipients(getHeader("To")),
      cc: parseRecipients(getHeader("Cc")),
    };
  }
}

// ============================================================================
// Drafts
// ============================================================================

/**
 * List draft messages via direct Gmail/MS Graph API.
 *
 * Fetches draft messages from the Drafts folder without using Superhuman's UI.
 *
 * @param token - Token info with accessToken and isMicrosoft flag
 * @param limit - Maximum results (default 50)
 * @param offset - Results offset for pagination (default 0)
 * @returns Array of DraftMessage objects
 */
export async function listDrafts(
  token: TokenInfo,
  limit: number = 50,
  offset: number = 0
): Promise<DraftMessage[]> {
  if (token.isMicrosoft) {
    // MS Graph: GET /me/mailFolders('Drafts')/messages
    const path = `/me/mailFolders('Drafts')/messages?$top=${limit}&$skip=${offset}&$select=id,subject,from,toRecipients,bodyPreview,receivedDateTime&$orderby=receivedDateTime desc`;
    const result = await msgraphFetch(token.accessToken, path) as MSGraphMessagesResponse | null;

    if (!result || !result.value) {
      return [];
    }

    return result.value.map((message: any) => ({
      id: message.id,
      subject: message.subject || "(no subject)",
      from: message.from?.emailAddress?.address || "",
      to: (message.toRecipients || []).map((r: any) => r.emailAddress?.address || "").filter(Boolean),
      preview: message.bodyPreview || "",
      timestamp: message.receivedDateTime || new Date().toISOString(),
    }));
  } else {
    const draftRefs = await listGmailDraftRefs(token.accessToken, limit, offset);

    if (draftRefs.length === 0) {
      return [];
    }

    const drafts: DraftMessage[] = [];

    // For each draft message ID, fetch its details
    for (const draft of draftRefs) {
      try {
        const detailPath = `/drafts/${draft.id}?format=full`;
        const detailResult = await gmailFetch(token.accessToken, detailPath);

        if (!detailResult || !detailResult.message) {
          continue;
        }

        const message = detailResult.message;
        const payload = message.payload || {};
        const headers = payload.headers || [];

        // Helper to get header value
        const getHeader = (name: string) =>
          headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

        // Parse From header (format: "Name <email>" or just "email")
        const fromHeader = getHeader("From");
        const fromMatch = fromHeader.match(/<([^>]+)>/) || [null, fromHeader];
        const from = fromMatch[1] || fromHeader;

        // Parse To header
        const parseRecipients = (header: string): string[] => {
          if (!header) return [];
          return header
            .split(",")
            .map((r) => {
              const match = r.match(/<([^>]+)>/) || [null, r.trim()];
              return match[1] || r.trim();
            })
            .filter(Boolean);
        };

        const to = parseRecipients(getHeader("To"));

        // Extract body preview
        let preview = "";
        function extractPreview(part: any): void {
          if (part.body?.data) {
            const content = Buffer.from(part.body.data, "base64url").toString("utf-8");
            preview = content.substring(0, 200); // First 200 chars
          } else if (part.parts) {
            for (const p of part.parts) {
              if (!preview) {
                extractPreview(p);
              }
            }
          }
        }
        extractPreview(payload);

        // Use snippet as fallback for preview
        if (!preview && message.snippet) {
          preview = message.snippet;
        }

        // Get timestamp
        const dateHeader = getHeader("Date");
        const timestamp = dateHeader || new Date(parseInt(message.internalDate || "0")).toISOString();

        drafts.push({
          id: detailResult.id || draft.id,
          subject: getHeader("Subject") || "(no subject)",
          from,
          to,
          preview,
          timestamp,
        });
      } catch (error) {
        // Log error but continue processing other drafts
        log.error(`Error fetching draft ${draft.id}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }

    return drafts;
  }
}

/**
 * Create a draft via direct Gmail/MS Graph API.
 *
 * @param token - Token info
 * @param options - Email options
 * @returns Draft ID or null on failure
 */
export async function createDraft(
  token: TokenInfo,
  options: SendEmailDirectOptions
): Promise<{ draftId: string; messageId?: string } | null> {
  if (token.isMicrosoft) {
    // MS Graph: POST /me/messages (creates draft in Drafts folder)
    const message: Record<string, unknown> = {
      subject: options.subject,
      body: {
        contentType: options.isHtml !== false ? "HTML" : "Text",
        content: options.body,
      },
      toRecipients: options.to.map((email) => ({
        emailAddress: { address: email },
      })),
    };

    if (options.cc && options.cc.length > 0) {
      message.ccRecipients = options.cc.map((email) => ({
        emailAddress: { address: email },
      }));
    }

    if (options.bcc && options.bcc.length > 0) {
      message.bccRecipients = options.bcc.map((email) => ({
        emailAddress: { address: email },
      }));
    }

    // Note: MS Graph doesn't support custom In-Reply-To/References headers
    // Threading is handled by conversationId automatically

    const result = await msgraphFetch(token.accessToken, "/me/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!result || !result.id) {
      return null;
    }

    return { draftId: result.id, messageId: result.id };
  } else {
    // Gmail: POST /drafts with raw MIME message
    const mimeMessage = buildMimeMessage({
      from: token.email,
      to: options.to,
      cc: options.cc,
      bcc: options.bcc,
      subject: options.subject,
      body: options.body,
      isHtml: options.isHtml,
      inReplyTo: options.inReplyTo,
      references: options.references,
    });

    const payload: Record<string, unknown> = {
      message: { raw: mimeMessage },
    };

    if (options.threadId) {
      (payload.message as Record<string, unknown>).threadId = options.threadId;
    }

    const result = await gmailFetch(token.accessToken, "/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!result || !result.id) {
      return null;
    }

    return { draftId: result.id, messageId: result.message?.id };
  }
}

// ============================================================================
// Send
// ============================================================================

/**
 * Send an email via direct Gmail/MS Graph API.
 *
 * @param token - Token info
 * @param options - Email options
 * @returns Message ID or null on failure
 */
export async function sendEmail(
  token: TokenInfo,
  options: SendEmailDirectOptions
): Promise<{ messageId: string; threadId?: string } | null> {
  if (token.isMicrosoft) {
    // MS Graph: POST /me/sendMail
    const message: Record<string, unknown> = {
      subject: options.subject,
      body: {
        contentType: options.isHtml !== false ? "HTML" : "Text",
        content: options.body,
      },
      toRecipients: options.to.map((email) => ({
        emailAddress: { address: email },
      })),
    };

    if (options.cc && options.cc.length > 0) {
      message.ccRecipients = options.cc.map((email) => ({
        emailAddress: { address: email },
      }));
    }

    if (options.bcc && options.bcc.length > 0) {
      message.bccRecipients = options.bcc.map((email) => ({
        emailAddress: { address: email },
      }));
    }

    const response = await fetch(`${MSGRAPH_API_BASE}/me/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    // sendMail returns 202 Accepted with no body on success
    if (response.status === 202 || response.ok) {
      return { messageId: "sent", threadId: options.threadId };
    }

    return null;
  } else {
    // Gmail: POST /messages/send with raw MIME message
    const mimeMessage = buildMimeMessage({
      from: token.email,
      to: options.to,
      cc: options.cc,
      bcc: options.bcc,
      subject: options.subject,
      body: options.body,
      isHtml: options.isHtml,
      inReplyTo: options.inReplyTo,
      references: options.references,
    });

    const payload: Record<string, unknown> = { raw: mimeMessage };

    if (options.threadId) {
      payload.threadId = options.threadId;
    }

    const result = await gmailFetch(token.accessToken, "/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!result || !result.id) {
      return null;
    }

    return { messageId: result.id, threadId: result.threadId };
  }
}

// ============================================================================
// Reply
// ============================================================================

/**
 * Create a reply draft via direct API.
 * Fetches thread info and creates a properly threaded draft.
 *
 * @param token - Token info
 * @param threadId - Thread to reply to
 * @param body - Reply body
 * @param options - Additional options
 * @returns Draft ID or null on failure
 */
export async function createReplyDraft(
  token: TokenInfo,
  threadId: string,
  body: string,
  options?: {
    replyAll?: boolean;
    cc?: string[];
    bcc?: string[];
    isHtml?: boolean;
  }
): Promise<{ draftId: string; messageId?: string } | null> {
  if (token.isMicrosoft) {
    // MS Graph: Use createReply/createReplyAll endpoint
    // First, get the last message ID in the conversation
    const safeReplyThreadId = escapeODataStringLiteral(threadId);
    const messagesPath = `/me/messages?$filter=conversationId eq '${safeReplyThreadId}'&$select=id&$orderby=receivedDateTime desc&$top=1`;
    const messagesResult = await msgraphFetch(token.accessToken, messagesPath);

    if (!messagesResult || !messagesResult.value || messagesResult.value.length === 0) {
      return null;
    }

    const lastMessageId = messagesResult.value[0].id;
    const endpoint = options?.replyAll ? "createReplyAll" : "createReply";

    // Create reply draft
    const createPath = `/me/messages/${lastMessageId}/${endpoint}`;
    const draftResult = await msgraphFetch(token.accessToken, createPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!draftResult || !draftResult.id) {
      return null;
    }

    // Update the draft with our body
    const patchBody: Record<string, unknown> = {
      body: {
        contentType: options?.isHtml !== false ? "HTML" : "Text",
        content: body,
      },
    };

    if (options?.cc && options.cc.length > 0) {
      patchBody.ccRecipients = options.cc.map((email) => ({
        emailAddress: { address: email },
      }));
    }

    if (options?.bcc && options.bcc.length > 0) {
      patchBody.bccRecipients = options.bcc.map((email) => ({
        emailAddress: { address: email },
      }));
    }

    await msgraphFetch(token.accessToken, `/me/messages/${draftResult.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    });

    return { draftId: draftResult.id, messageId: draftResult.id };
  } else {
    // Gmail: Get thread info and create draft with threading headers
    const threadInfo = await getThreadInfo(token, threadId);
    if (!threadInfo) {
      return null;
    }

    // Build recipient list
    const to: string[] = [];
    const cc: string[] = options?.cc || [];

    if (options?.replyAll) {
      // Include original sender plus all To/Cc (excluding self)
      if (threadInfo.from && threadInfo.from.toLowerCase() !== token.email.toLowerCase()) {
        to.push(threadInfo.from);
      }
      for (const email of threadInfo.to) {
        if (email.toLowerCase() !== token.email.toLowerCase() && !to.includes(email)) {
          to.push(email);
        }
      }
      for (const email of threadInfo.cc) {
        if (email.toLowerCase() !== token.email.toLowerCase() && !cc.includes(email)) {
          cc.push(email);
        }
      }
    } else {
      // Simple reply to sender
      if (threadInfo.from) {
        to.push(threadInfo.from);
      }
    }

    if (to.length === 0) {
      return null;
    }

    // Build subject with Re: prefix
    const subject = threadInfo.subject.startsWith("Re:")
      ? threadInfo.subject
      : `Re: ${threadInfo.subject}`;

    return createDraft(token, {
      to,
      cc,
      bcc: options?.bcc,
      subject,
      body,
      isHtml: options?.isHtml,
      threadId,
      inReplyTo: threadInfo.messageId || undefined,
      references: threadInfo.references,
    });
  }
}

/**
 * Send a reply via direct API.
 * Fetches thread info and sends a properly threaded reply.
 *
 * @param token - Token info
 * @param threadId - Thread to reply to
 * @param body - Reply body
 * @param options - Additional options
 * @returns Message ID or null on failure
 */
export async function sendReply(
  token: TokenInfo,
  threadId: string,
  body: string,
  options?: {
    replyAll?: boolean;
    cc?: string[];
    bcc?: string[];
    isHtml?: boolean;
  }
): Promise<{ messageId: string; threadId?: string } | null> {
  if (token.isMicrosoft) {
    // MS Graph: Create reply draft then send it
    const draftResult = await createReplyDraft(token, threadId, body, options);
    if (!draftResult) {
      return null;
    }

    // Send the draft
    const sendPath = `/me/messages/${draftResult.draftId}/send`;
    const response = await fetch(`${MSGRAPH_API_BASE}${sendPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 202 || response.ok) {
      return { messageId: draftResult.draftId, threadId };
    }

    return null;
  } else {
    // Gmail: Get thread info and send with threading headers
    const threadInfo = await getThreadInfo(token, threadId);
    if (!threadInfo) {
      return null;
    }

    // Build recipient list (same logic as createReplyDraft)
    const to: string[] = [];
    const cc: string[] = options?.cc || [];

    if (options?.replyAll) {
      if (threadInfo.from && threadInfo.from.toLowerCase() !== token.email.toLowerCase()) {
        to.push(threadInfo.from);
      }
      for (const email of threadInfo.to) {
        if (email.toLowerCase() !== token.email.toLowerCase() && !to.includes(email)) {
          to.push(email);
        }
      }
      for (const email of threadInfo.cc) {
        if (email.toLowerCase() !== token.email.toLowerCase() && !cc.includes(email)) {
          cc.push(email);
        }
      }
    } else {
      if (threadInfo.from) {
        to.push(threadInfo.from);
      }
    }

    if (to.length === 0) {
      return null;
    }

    const subject = threadInfo.subject.startsWith("Re:")
      ? threadInfo.subject
      : `Re: ${threadInfo.subject}`;

    return sendEmail(token, {
      to,
      cc,
      bcc: options?.bcc,
      subject,
      body,
      isHtml: options?.isHtml,
      threadId,
      inReplyTo: threadInfo.messageId || undefined,
      references: threadInfo.references,
    });
  }
}

// ============================================================================
// Draft Management
// ============================================================================

/**
 * Update an existing draft via direct Gmail/MS Graph API.
 *
 * @param token - Token info
 * @param draftId - Draft ID to update
 * @param options - Fields to update (only provided fields are changed)
 * @returns Updated draft info or null on failure
 */
export async function updateDraft(
  token: TokenInfo,
  draftId: string,
  options: {
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body?: string;
    isHtml?: boolean;
  }
): Promise<{ draftId: string; messageId?: string } | null> {
  if (token.isMicrosoft) {
    // MS Graph: PATCH /me/messages/{id}
    const updates: Record<string, unknown> = {};

    if (options.subject !== undefined) {
      updates.subject = options.subject;
    }
    if (options.body !== undefined) {
      updates.body = {
        contentType: (options.isHtml ?? true) ? "HTML" : "Text",
        content: options.body,
      };
    }
    if (options.to) {
      updates.toRecipients = options.to.map((email) => ({
        emailAddress: { address: email },
      }));
    }
    if (options.cc) {
      updates.ccRecipients = options.cc.map((email) => ({
        emailAddress: { address: email },
      }));
    }
    if (options.bcc) {
      updates.bccRecipients = options.bcc.map((email) => ({
        emailAddress: { address: email },
      }));
    }

    const result = await msgraphFetch(token.accessToken, `/me/messages/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!result?.id) return null;
    return { draftId: result.id, messageId: result.id };
  } else {
    // Gmail: GET existing draft, merge updates, PUT back
    const existing = await gmailFetch(token.accessToken, `/drafts/${draftId}?format=full`);
    if (!existing?.message) return null;

    const existingHeaders = existing.message.payload?.headers || [];
    const getHeader = (name: string) =>
      existingHeaders.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

    const to = options.to || getHeader("To").split(",").map((s: string) => s.trim()).filter(Boolean);
    const cc = options.cc || getHeader("Cc").split(",").map((s: string) => s.trim()).filter(Boolean);
    const bcc = options.bcc || getHeader("Bcc").split(",").map((s: string) => s.trim()).filter(Boolean);
    const subject = options.subject ?? getHeader("Subject");

    // Extract existing body if not being replaced
    let body = options.body;
    let isHtml = options.isHtml ?? true;
    if (body === undefined) {
      const payload = existing.message.payload;
      const extractBody = (part: any): string | undefined => {
        if (part.mimeType === "text/html" && part.body?.data) {
          isHtml = true;
          return Buffer.from(part.body.data, "base64url").toString("utf-8");
        }
        if (part.mimeType === "text/plain" && part.body?.data) {
          return Buffer.from(part.body.data, "base64url").toString("utf-8");
        }
        if (part.parts) {
          for (const p of part.parts) {
            const result = extractBody(p);
            if (result) return result;
          }
        }
        return undefined;
      };
      body = extractBody(payload) || "";
    }

    const mimeMessage = buildMimeMessage({
      from: token.email,
      to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      subject,
      body: body || "",
      isHtml,
      inReplyTo: getHeader("In-Reply-To") || undefined,
      references: getHeader("References") ? getHeader("References").split(/\s+/).filter(Boolean) : undefined,
    });

    const payload: Record<string, unknown> = {
      message: { raw: mimeMessage },
    };
    if (existing.message.threadId) {
      (payload.message as Record<string, unknown>).threadId = existing.message.threadId;
    }

    const result = await fetch(
      `${GMAIL_API_BASE}/drafts/${draftId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!result.ok) return null;
    const data = JSON.parse(await result.text()) as { id: string; message?: { id: string } };
    return { draftId: data.id, messageId: data.message?.id };
  }
}

/**
 * Delete a draft via direct API.
 *
 * @param token - Token info
 * @param draftId - Draft ID to delete
 * @returns true on success
 */
export async function deleteDraft(
  token: TokenInfo,
  draftId: string
): Promise<boolean> {
  if (token.isMicrosoft) {
    // MS Graph: DELETE /me/messages/{id}
    const response = await fetch(`${MSGRAPH_API_BASE}/me/messages/${draftId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    return response.status === 204 || response.ok;
  } else {
    // Gmail: DELETE /drafts/{id}
    const response = await fetch(`${GMAIL_API_BASE}/drafts/${draftId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    return response.status === 204 || response.ok;
  }
}

/**
 * Send an existing draft by ID via direct API.
 *
 * @param token - Token info
 * @param draftId - Draft ID to send
 * @returns Message ID or null on failure
 */
export async function sendDraft(
  token: TokenInfo,
  draftId: string
): Promise<{ messageId: string; threadId?: string } | null> {
  if (token.isMicrosoft) {
    // MS Graph: POST /me/messages/{id}/send
    const response = await fetch(`${MSGRAPH_API_BASE}/me/messages/${draftId}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 202 || response.ok) {
      return { messageId: draftId };
    }

    return null;
  } else {
    // Gmail: POST /drafts/send with draft ID
    // Note: Gmail uses a different endpoint pattern
    const result = await gmailFetch(token.accessToken, `/drafts/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: draftId }),
    });

    if (!result || !result.id) {
      return null;
    }

    return { messageId: result.id, threadId: result.threadId };
  }
}

// ============================================================================
// Thread Messages (Full Content)
// ============================================================================

/**
 * Parse an email address string like "Name <email>" or just "email".
 */
function parseEmailAddress(raw: string): { email: string; name: string } {
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { name: (match[1] ?? "").trim().replace(/^"|"$/g, ""), email: match[2] ?? "" };
  }
  return { name: "", email: raw.trim() };
}

/**
 * Parse a comma-separated list of email addresses from a header value.
 */
function parseRecipientList(header: string): Array<{ email: string; name: string }> {
  if (!header) return [];
  return header.split(",").map((r) => parseEmailAddress(r.trim())).filter((r) => r.email);
}

/**
 * Map an MS Graph emailAddress object to { email, name }.
 */
function mapMsGraphContact(contact: any): { email: string; name: string } {
  return {
    email: contact?.emailAddress?.address || "",
    name: contact?.emailAddress?.name || "",
  };
}

/**
 * Map an array of MS Graph recipient objects to { email, name }[].
 */
function mapMsGraphContacts(recipients: any[] | undefined): Array<{ email: string; name: string }> {
  return (recipients || []).map(mapMsGraphContact);
}

/**
 * Get full thread messages for MS Graph accounts.
 */
async function getThreadMessagesMsGraph(
  token: TokenInfo,
  threadId: string
): Promise<FullThreadMessage[]> {
  // Prefer server-side conversationId filter, but fall back to pagination when
  // Graph rejects it with "InefficientFilter".
  const selectFields = "id,subject,body,conversationId,receivedDateTime,from,toRecipients,ccRecipients,bodyPreview";
  let messages: any[] = await fetchMsGraphConversationMessages(token, threadId, selectFields);

  // Sort oldest first for thread context
  messages.sort((a: any, b: any) =>
    new Date(a.receivedDateTime).getTime() - new Date(b.receivedDateTime).getTime()
  );

  // Fallback: if threadId is actually a message ID, fetch it directly
  if (messages.length === 0) {
    const fallbackFields = "id,subject,body,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview";
    try {
      const msg = await msgraphFetch(token.accessToken, `/me/messages/${threadId}?$select=${fallbackFields}`);
      if (msg) {
        messages = [msg];
      }
    } catch (error) {
      log.error("MS Graph thread message ID fallback: %s", error instanceof Error ? error.message : String(error));
    }
  }

  return messages.map((msg: any) => ({
    message_id: msg.id,
    subject: msg.subject || "",
    body: msg.body?.content || "",
    from: mapMsGraphContact(msg.from),
    to: mapMsGraphContacts(msg.toRecipients),
    cc: mapMsGraphContacts(msg.ccRecipients),
    date: msg.receivedDateTime || "",
    snippet: msg.bodyPreview || "",
  }));
}

/**
 * Get full thread messages for Gmail accounts.
 */
async function getThreadMessagesGmail(
  token: TokenInfo,
  threadId: string
): Promise<FullThreadMessage[]> {
  const result = await gmailFetch(token.accessToken, `/threads/${threadId}?format=full`);

  if (!result || !result.messages) {
    return [];
  }

  return result.messages.map((msg: any) => {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string): string => {
      const h = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
      return h?.value || "";
    };

    // Extract body from MIME parts, preferring plain text over HTML
    let body = "";
    function extractBody(part: any): void {
      if (part.mimeType === "text/plain" && part.body?.data) {
        body = Buffer.from(part.body.data, "base64url").toString("utf-8");
      } else if (part.mimeType === "text/html" && part.body?.data && !body) {
        const htmlBody = Buffer.from(part.body.data, "base64url").toString("utf-8");
        body = htmlBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
      if (part.parts) {
        for (const p of part.parts) {
          extractBody(p);
        }
      }
    }
    extractBody(msg.payload);

    return {
      message_id: msg.id,
      subject: getHeader("Subject"),
      body: body || msg.snippet || "",
      from: parseEmailAddress(getHeader("From")),
      to: parseRecipientList(getHeader("To")),
      cc: parseRecipientList(getHeader("Cc")),
      date: getHeader("Date"),
      snippet: msg.snippet || "",
    };
  });
}

/**
 * Get full thread messages with all metadata.
 * Fetches complete thread content including body text, headers, and recipients.
 *
 * @param token - OAuth token info
 * @param threadId - Thread ID to get messages from
 * @returns Array of full thread messages
 */
export async function getThreadMessages(
  token: TokenInfo,
  threadId: string
): Promise<FullThreadMessage[]> {
  if (token.isMicrosoft) {
    return getThreadMessagesMsGraph(token, threadId);
  }
  return getThreadMessagesGmail(token, threadId);
}
