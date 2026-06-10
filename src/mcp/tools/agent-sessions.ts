/**
 * MCP tool handlers for AI sidebar conversations (agent sessions):
 * list, read. (Discard/restore were dropped in v0.16.0 as unused —
 * housekeeping happens in-app.)
 */

import { z } from "zod";
import type { SuperhumanConnection } from "../../superhuman-api";
import { successResult, errorResult, actionableError, getCdpConnection, type ToolResult } from "./shared";

// ---------------------------------------------------------------------------
// Types (matching Superhuman internal shapes)
// ---------------------------------------------------------------------------

interface RawAgentSession {
  id: string;
  updated_at: number;
  title: string;
  json: string;
  is_discarded: number;
}

interface AgentSessionEvent {
  agentSessionId: string;
  speaker: "user" | "agent";
  payload: {
    event_id: string;
    session_id: string;
    content: string;
    in_reply_to_event_id?: string;
    finished?: boolean;
    active_agent?: string;
  };
}

interface AgentSessionPayload {
  agentSessionId: string;
  historyId: number;
  title: string;
  events: AgentSessionEvent[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const AgentSessionsSchema = z.object({
  include_discarded: z.boolean().optional().describe("Include discarded (soft-deleted) sessions in the list. Default: false."),
}).strict();

export const AgentSessionReadSchema = z.object({
  sessionId: z.string().describe("The session UUID to read. Get session IDs from superhuman_agent_sessions."),
}).strict();

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Remove <thinking>...</thinking> blocks from content. */
export function stripThinking(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/g, "").trim();
}

/** Truncate text beyond `limit` chars, appending a note with full length. */
export function truncateContent(text: string, limit = 2000): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n[...truncated, full length: ${text.length} chars]`;
}

/** Format a list of raw sessions into a numbered summary string. */
export function formatSessionList(sessions: RawAgentSession[], includeDiscarded: boolean): string {
  let filtered = sessions;
  if (!includeDiscarded) {
    filtered = sessions.filter(s => s.is_discarded === 0);
  }

  // Sort by updated_at descending (most recent first)
  filtered.sort((a, b) => b.updated_at - a.updated_at);

  if (filtered.length === 0) {
    return includeDiscarded
      ? "No agent sessions found (including discarded)."
      : "No agent sessions found. Use include_discarded=true to include soft-deleted sessions.";
  }

  const lines = filtered.map((s, i) => {
    let eventCount = 0;
    try {
      const payload = JSON.parse(s.json) as AgentSessionPayload;
      eventCount = payload.events?.length ?? 0;
    } catch {
      // malformed json — show 0 events
    }

    const date = new Date(s.updated_at).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    const discardedTag = s.is_discarded ? " [DISCARDED]" : "";
    return `${i + 1}. "${s.title}" (ID: ${s.id}, updated: ${date}, ${eventCount} messages)${discardedTag}`;
  });

  return lines.join("\n");
}

/** Format a session payload into a conversation transcript. */
export function formatTranscript(session: RawAgentSession): string {
  let payload: AgentSessionPayload;
  try {
    payload = JSON.parse(session.json) as AgentSessionPayload;
  } catch {
    return `Session "${session.title}" — could not parse conversation data.`;
  }

  const events = payload.events ?? [];
  if (events.length === 0) {
    return `Session "${session.title}" — no messages.`;
  }

  const header = `# ${session.title}\n(${events.length} messages, last updated: ${payload.updatedAt || new Date(session.updated_at).toISOString()})\n`;

  const messages = events
    .map(evt => {
      const speaker = evt.speaker === "user" ? "You" : "AI";
      let content = evt.payload?.content ?? "";
      content = stripThinking(content);
      content = content.trim();
      if (!content) return null; // skip empty tool-use events
      content = truncateContent(content);
      return `**${speaker}:** ${content}`;
    })
    .filter(Boolean);

  return header + "\n" + messages.join("\n\n");
}

// ---------------------------------------------------------------------------
// CDP helpers
// ---------------------------------------------------------------------------

/** Evaluate an async IIFE in the Superhuman renderer and return the result. */
async function evalInRenderer<T>(conn: SuperhumanConnection, expression: string): Promise<T> {
  const result = await conn.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || "Unknown CDP evaluation error";
    throw new Error(msg);
  }

  return result.result.value as T;
}

/** Fetch all agent sessions via CDP portal API. */
export async function fetchAllSessions(conn: SuperhumanConnection): Promise<RawAgentSession[]> {
  return evalInRenderer<RawAgentSession[]>(conn, `
    (async () => {
      try {
        const portal = window.GoogleAccount.di.get("portal");
        const sessions = await portal.invoke("agentSessionsInternal", "getAllSessions", []);
        return sessions || [];
      } catch (e) {
        throw new Error("Failed to fetch agent sessions: " + (e.message || String(e)));
      }
    })()
  `);
}

/** Fetch a single agent session by ID via CDP portal API. */
export async function fetchSession(conn: SuperhumanConnection, sessionId: string): Promise<RawAgentSession> {
  const session = await evalInRenderer<RawAgentSession | null>(conn, `
    (async () => {
      try {
        const portal = window.GoogleAccount.di.get("portal");
        return await portal.invoke("agentSessionsInternal", "getSession", [${JSON.stringify(sessionId)}]);
      } catch (e) {
        throw new Error("Failed to fetch agent session: " + (e.message || String(e)));
      }
    })()
  `);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function agentSessionsHandler(args: z.infer<typeof AgentSessionsSchema>): Promise<ToolResult> {
  try {
    const conn = await getCdpConnection();
    const sessions = await fetchAllSessions(conn);
    const text = formatSessionList(sessions, args.include_discarded ?? false);
    return successResult(text);
  } catch (error) {
    return actionableError("Failed to list agent sessions", error);
  }
}

export async function agentSessionReadHandler(args: z.infer<typeof AgentSessionReadSchema>): Promise<ToolResult> {
  if (!args.sessionId) {
    return errorResult("sessionId is required. Use superhuman_agent_sessions to list available sessions and their IDs.");
  }

  try {
    const conn = await getCdpConnection();
    const session = await fetchSession(conn, args.sessionId);
    const text = formatTranscript(session);
    return successResult(text);
  } catch (error) {
    return actionableError(`Failed to read agent session ${args.sessionId}`, error);
  }
}

