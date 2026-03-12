/**
 * Superhuman AI and backend operations.
 *
 * Provides access to Superhuman's AI compose and Ask AI proxy endpoints,
 * including ID generation helpers that match Superhuman's internal format.
 */

import type {
  TokenInfo,
  AIChatMessage,
  FullThreadMessage,
  AIQueryOptions,
  AIQueryResult,
} from "../auth/types";
import { randomInt, randomUUID } from "node:crypto";
import { SUPERHUMAN_BACKEND_BASE } from "./http-utils";
import { getThreadMessages } from "./gmail-client";
import { createLogger } from "../logger";

const log = createLogger("superhuman-api");

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Base62 charset used for Superhuman IDs.
 */
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generate random characters from Base62 charset.
 */
function randomBase62(length: number): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += BASE62.charAt(randomInt(BASE62.length));
  }
  return result;
}

/**
 * Generate a unique event ID in Superhuman's format.
 *
 * Superhuman event IDs follow this structure (18 chars after prefix):
 * - Position 0-2: "11V" format prefix
 * - Position 3-6: 4 random chars (timestamp-like)
 * - Position 7-10: User prefix (e.g., "4sKP") - identifies the user
 * - Position 11-17: 7 random chars
 *
 * @param userPrefix - The 4-character user prefix extracted from Superhuman
 * @returns A properly formatted event ID like "event_11VXxxx4sKPxxxxxxx"
 */
function generateEventId(userPrefix: string = ""): string {
  // If no user prefix provided, fall back to old random generation
  if (!userPrefix || userPrefix.length !== 4) {
    return `event_${randomBase62(18)}`;
  }

  // Format: 11V + 4 random + userPrefix + 7 random = 18 chars total
  const formatPrefix = "11V";
  const midSection = randomBase62(4);
  const randomSuffix = randomBase62(7);

  return `event_${formatPrefix}${midSection}${userPrefix}${randomSuffix}`;
}

/**
 * Decode a JWT token payload without verification.
 * Used to extract claims like `sub` (Google provider ID) from Superhuman's idToken.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) return {};
  try {
    const payload = Buffer.from(parts[1] ?? "", "base64url").toString("utf-8");
    return JSON.parse(payload);
  } catch (error) {
    log.error(`JWT decode: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

/**
 * Format a FullThreadMessage for the askAIProxy API.
 * The proxy expects string-formatted from/to/cc/bcc fields, not objects.
 */
function formatMessageForAIProxy(m: FullThreadMessage): Record<string, unknown> {
  const formatContact = (c: { email: string; name: string }) =>
    c.name ? `${c.name} <${c.email}>` : c.email;
  const formatContacts = (contacts: Array<{ email: string; name: string }>) =>
    contacts.map(formatContact).join(", ");

  return {
    message_id: m.message_id,
    subject: m.subject,
    body: m.body,
    date: m.date,
    from: formatContact(m.from),
    to: formatContacts(m.to),
    cc: formatContacts(m.cc),
    bcc: "",
    links: [],
    attachment_names: [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ask Superhuman AI to compose or reply using the /v3/ai.compose endpoint.
 *
 * In reply mode (when threadId is provided), fetches the thread messages for
 * context and builds a reply payload. In compose mode, sends a standalone
 * compose request.
 *
 * The response is parsed from an SSE stream where each `data:` line contains
 * a JSON chunk with `choices[0].delta.content`.
 *
 * Note: Uses raw fetch() instead of superhumanFetch/authFetch because SSE
 * streaming requires direct body handling. Throws on 401/403 rather than
 * returning null — callers should use try-catch for auth errors.
 *
 * @param superhumanToken - Superhuman backend token (idToken JWT)
 * @param oauthToken      - OAuth token for the account
 * @param threadId        - Gmail thread ID for reply mode, or undefined for compose
 * @param query           - Natural language instructions for the AI
 * @param options         - Additional session and user options
 * @returns AI-generated draft content with session info
 */
export async function askAI(
  superhumanToken: string,
  oauthToken: TokenInfo,
  threadId: string | undefined,
  query: string,
  options?: AIQueryOptions,
): Promise<AIQueryResult> {
  const sessionId = options?.sessionId || randomUUID();

  let payload: Record<string, unknown>;

  if (threadId) {
    // Reply mode: fetch thread messages for context
    const fullMessages = await getThreadMessages(oauthToken, threadId);
    const threadMessages = fullMessages.map((m) => ({
      message_id: m.message_id,
      subject: m.subject,
      body: m.body,
    }));

    if (threadMessages.length === 0) {
      throw new Error(`Thread not found or has no messages: ${threadId}`);
    }

    // Build thread_content string from messages (what Superhuman passes to its backend)
    const threadContent = threadMessages
      .map((m) => `Subject: ${m.subject}\n\n${m.body}`)
      .join("\n\n---\n\n");

    const lastMessage = threadMessages[threadMessages.length - 1];

    payload = {
      instructions: query,
      draft_content: "",
      draft_content_type: "text/html",
      draft_action: "reply",
      thread_content: threadContent,
      subject: threadMessages[0]?.subject || "",
      to: [],
      cc: [],
      bcc: [],
      thread_id: threadId,
      last_message_id: lastMessage!.message_id,
    };
  } else {
    // Compose mode: no thread context needed
    payload = {
      instructions: query,
      draft_content: "",
      draft_content_type: "text/html",
      draft_action: "compose",
      thread_content: "",
      subject: "",
      to: [],
      cc: [],
      bcc: [],
      thread_id: "",
      last_message_id: "",
    };
  }

  const url = `${SUPERHUMAN_BACKEND_BASE}/v3/ai.compose`;

  const fetchResponse = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${superhumanToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (fetchResponse.status === 401 || fetchResponse.status === 403) {
    throw new Error("AI query failed - authentication error");
  }

  if (!fetchResponse.ok) {
    const errorText = await fetchResponse.text().catch(() => "Unknown error");
    throw new Error(
      `AI query failed: ${fetchResponse.status} ${fetchResponse.statusText} - ${errorText}`,
    );
  }

  // Parse the streaming response (Server-Sent Events format)
  // ai.compose returns chunks like: data: {"choices":[{"delta":{"content":"text"}}]}
  const responseText = await fetchResponse.text();
  let fullContent = "";

  for (const line of responseText.split("\n")) {
    if (line.startsWith("data: ")) {
      const jsonStr = line.substring(6).trim();
      if (jsonStr === "[DONE]" || jsonStr === "END" || jsonStr === "") continue;

      try {
        const data = JSON.parse(jsonStr);
        // ai.compose format: choices[0].delta.content
        const delta = data?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") {
          fullContent += delta;
        }
        // Also handle legacy askAIProxy format (content at top level)
        if (data.content && !data.choices) {
          fullContent = data.content;
        }
      } catch (error) {
        log.error(`SSE JSON parse - ai.compose: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return {
    response: fullContent || responseText,
    sessionId,
  };
}

/**
 * Query Superhuman's Ask AI search using the /v3/ai.askAIProxy endpoint.
 *
 * This is the full Ask AI feature -- supports search, summarization, drafting, etc.
 * The AI decides what to do based on the query and available skills.
 *
 * Note: Uses raw fetch() instead of superhumanFetch/authFetch because SSE
 * streaming requires direct body handling. Throws on 401/403 rather than
 * returning null — callers should use try-catch for auth errors.
 *
 * @param superhumanToken - Superhuman backend token (idToken JWT)
 * @param oauthToken      - OAuth token for the account
 * @param query           - Natural language query
 * @param options         - Additional options (threadId, session, user info)
 * @returns AI response with session info
 */
export async function askAISearch(
  superhumanToken: string,
  oauthToken: TokenInfo,
  query: string,
  options?: AIQueryOptions & { threadId?: string },
): Promise<AIQueryResult> {
  const sessionId = options?.sessionId || randomUUID();

  // Extract provider_id from the JWT idToken
  const jwtPayload = decodeJwtPayload(superhumanToken);
  const providerId =
    (jwtPayload.sub as string) || (jwtPayload.user_id as string) || "";

  // Use stored user prefix for event ID generation
  const userPrefix = options?.userPrefix || oauthToken.userPrefix || "";

  // Generate question event ID
  const questionEventId = generateEventId(userPrefix);

  // Build current_thread_messages if a thread is specified
  const currentThreadId = options?.threadId || "";
  let currentThreadMessages: Record<string, unknown>[] = [];

  if (currentThreadId) {
    try {
      const fullMessages = await getThreadMessages(oauthToken, currentThreadId);
      currentThreadMessages = fullMessages.map(formatMessageForAIProxy);
    } catch (error) {
      log.error(`thread fetch for AI context: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get local datetime in ISO format with timezone offset
  const now = new Date();
  const tzOffset = -now.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? "+" : "-";
  const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, "0");
  const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, "0");
  const localDatetime =
    now
      .toISOString()
      .replace("Z", "")
      .replace(/\.\d+$/, "") + `${tzSign}${tzHours}:${tzMins}`;

  const payload = {
    session_id: sessionId,
    question_event_id: questionEventId,
    query,
    chat_history:
      options?.chatHistory?.map((m) => ({
        role: m.role,
        content: m.content,
      })) || [],
    user: {
      provider_id: providerId,
      email: options?.userEmail || oauthToken.email,
      name: options?.userName || "",
      company: options?.userCompany || "",
      position: options?.userPosition || "",
    },
    local_datetime: localDatetime,
    current_thread_id: currentThreadId,
    current_thread_messages: currentThreadMessages,
    available_skills: [
      "filter",
      "schedule",
      "multiMessage",
      "draft",
      "displayThoughts",
    ],
  };

  const url = `${SUPERHUMAN_BACKEND_BASE}/v3/ai.askAIProxy`;

  const fetchResponse = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${superhumanToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (fetchResponse.status === 401 || fetchResponse.status === 403) {
    throw new Error("AI query failed - authentication error");
  }

  if (!fetchResponse.ok) {
    const errorText = await fetchResponse.text().catch(() => "Unknown error");
    throw new Error(
      `AI query failed: ${fetchResponse.status} ${fetchResponse.statusText} - ${errorText}`,
    );
  }

  // Parse the SSE streaming response
  // askAIProxy returns cumulative content: each event has the full text up to that point
  const responseText = await fetchResponse.text();
  let fullContent = "";

  for (const line of responseText.split("\n")) {
    if (line.startsWith("data: ")) {
      const jsonStr = line.substring(6).trim();
      if (jsonStr === "[DONE]" || jsonStr === "END" || jsonStr === "") continue;

      try {
        const data = JSON.parse(jsonStr);
        // askAIProxy format: content at top level (cumulative)
        if (typeof data.content === "string") {
          fullContent = data.content;
        }
      } catch (error) {
        log.error(`SSE JSON parse - askAIProxy: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Strip <thinking>...</thinking> tags from the response
  fullContent = fullContent
    .replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, "")
    .trim();

  return {
    response: fullContent || responseText,
    sessionId,
  };
}
