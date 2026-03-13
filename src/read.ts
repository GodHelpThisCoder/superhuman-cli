/**
 * Read Module
 *
 * Functions for reading thread/message content via direct Gmail / MS Graph APIs.
 */

import type { ConnectionProvider } from "./connection-provider";
import { gmailFetch, msgraphFetch } from "./token-api";
import { escapeODataStringLiteral } from "./api/gmail-client";
import { createLogger } from "./logger";

const log = createLogger("read");

export interface ThreadMessage {
  id: string;
  threadId: string;
  subject: string;
  from: {
    email: string;
    name: string;
  };
  to: Array<{ email: string; name: string }>;
  cc: Array<{ email: string; name: string }>;
  date: string;
  snippet: string;
  body?: string;
}

/**
 * Parse a single email address from a header value like "Name <email>" or bare "email".
 */
function parseRecipient(str: string): { email: string; name: string } {
  const trimmed = str.trim();
  if (!trimmed) return { email: "", name: "" };
  const match = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1]!.trim().replace(/^["']|["']$/g, ""),
      email: match[2]!,
    };
  }
  return { email: trimmed, name: "" };
}

/**
 * Parse a comma-separated list of email addresses from a header value.
 */
function parseRecipientList(
  header: string
): Array<{ email: string; name: string }> {
  if (!header) return [];
  return header
    .split(",")
    .map(parseRecipient)
    .filter((r) => r.email);
}

/**
 * Read all messages in a thread via direct API calls (Gmail or MS Graph).
 */
export async function readThread(
  provider: ConnectionProvider,
  threadId: string
): Promise<ThreadMessage[]> {
  const token = await provider.getToken();

  if (token.isMicrosoft) {
    return readThreadMSGraph(token.accessToken, threadId);
  } else {
    return readThreadGmail(token.accessToken, threadId);
  }
}

/**
 * Read thread messages from Gmail API.
 */
async function readThreadGmail(
  accessToken: string,
  threadId: string
): Promise<ThreadMessage[]> {
  const result = await gmailFetch(
    accessToken,
    `/threads/${threadId}?format=full`
  );

  if (!result || !result.messages) {
    return [];
  }

  return result.messages.map((msg: any) => {
    const headers: Array<{ name: string; value: string }> =
      msg.payload?.headers || [];

    const getHeader = (name: string): string => {
      const h = headers.find(
        (h: any) => h.name.toLowerCase() === name.toLowerCase()
      );
      return h?.value || "";
    };

    const fromParsed = parseRecipient(getHeader("From"));

    // Extract body from payload parts (prefer HTML, fall back to plain text)
    let body = "";
    function extractBody(part: any): void {
      if (part.mimeType === "text/html" && part.body?.data) {
        body = Buffer.from(part.body.data, "base64url").toString("utf-8");
      } else if (part.mimeType === "text/plain" && part.body?.data && !body) {
        body = Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
      if (part.parts) {
        for (const p of part.parts) extractBody(p);
      }
    }
    if (msg.payload) extractBody(msg.payload);

    return {
      id: msg.id,
      threadId: result.id,
      subject: getHeader("Subject") || "(no subject)",
      from: fromParsed,
      to: parseRecipientList(getHeader("To")),
      cc: parseRecipientList(getHeader("Cc")),
      date: getHeader("Date"),
      snippet: msg.snippet || "",
      body: body || undefined,
    };
  });
}

/**
 * Read thread messages from MS Graph API.
 * Tries server-side $filter by conversationId first, falls back to client-side
 * filtering if the server returns an InefficientFilter error.
 */
async function readThreadMSGraph(
  accessToken: string,
  conversationId: string
): Promise<ThreadMessage[]> {
  let messages: any[] = [];

  // Try server-side filter first (handles threads beyond the top 50 messages)
  try {
    const safeConversationId = escapeODataStringLiteral(conversationId);
    const serverFilterPath = `/me/messages?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,conversationId&$filter=conversationId eq '${safeConversationId}'&$orderby=receivedDateTime asc`;
    const result = await msgraphFetch(accessToken, serverFilterPath);
    if (result?.value) {
      messages = result.value;
    }
  } catch {
    // InefficientFilter or other server-side filter error — fall back to client-side
  }

  // Fallback: client-side filter with $top=50
  if (messages.length === 0) {
    const fallbackPath = `/me/messages?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,conversationId&$top=50&$orderby=receivedDateTime desc`;
    const result = await msgraphFetch(accessToken, fallbackPath);
    if (result?.value) {
      messages = result.value.filter(
        (m: any) => m.conversationId === conversationId
      );
    }
    // Sort oldest first for thread reading order
    messages.sort(
      (a: any, b: any) =>
        new Date(a.receivedDateTime).getTime() -
        new Date(b.receivedDateTime).getTime()
    );
  }

  // Fallback: if conversationId is actually a message ID, fetch it directly
  if (messages.length === 0) {
    try {
      const msg = await msgraphFetch(
        accessToken,
        `/me/messages/${conversationId}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,conversationId`
      );
      if (msg) {
        messages = [msg];
      }
    } catch (error) {
      log.error(`MS Graph message ID fallback: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return messages.map((msg: any) => {
    const mapRecipient = (r: any): { email: string; name: string } => ({
      email: r?.emailAddress?.address || "",
      name: r?.emailAddress?.name || "",
    });

    return {
      id: msg.id,
      threadId: msg.conversationId || conversationId,
      subject: msg.subject || "(no subject)",
      from: mapRecipient(msg.from),
      to: (msg.toRecipients || []).map(mapRecipient),
      cc: (msg.ccRecipients || []).map(mapRecipient),
      date: msg.receivedDateTime || "",
      snippet: msg.bodyPreview || "",
      body: msg.body?.content || undefined,
    };
  });
}
