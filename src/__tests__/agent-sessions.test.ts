/**
 * Tests for agent session helpers: stripThinking, truncateContent,
 * formatSessionList, formatTranscript.
 */

import { describe, test, expect } from "bun:test";
import {
  stripThinking,
  truncateContent,
  formatSessionList,
  formatTranscript,
} from "../mcp/tools/agent-sessions";

// ---------------------------------------------------------------------------
// stripThinking
// ---------------------------------------------------------------------------

describe("stripThinking", () => {
  test("removes a single <thinking> block", () => {
    const input = "Hello <thinking>internal reasoning</thinking> world";
    expect(stripThinking(input)).toBe("Hello  world");
  });

  test("removes multiple <thinking> blocks", () => {
    const input = "<thinking>first</thinking>A<thinking>second</thinking>B";
    expect(stripThinking(input)).toBe("AB");
  });

  test("removes multiline <thinking> blocks", () => {
    const input = "Before\n<thinking>\nline1\nline2\n</thinking>\nAfter";
    expect(stripThinking(input)).toBe("Before\n\nAfter");
  });

  test("returns text unchanged when no <thinking> blocks", () => {
    const input = "Just normal text";
    expect(stripThinking(input)).toBe("Just normal text");
  });

  test("handles empty string", () => {
    expect(stripThinking("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// truncateContent
// ---------------------------------------------------------------------------

describe("truncateContent", () => {
  test("returns short text unchanged", () => {
    const text = "Short message";
    expect(truncateContent(text)).toBe(text);
  });

  test("returns text at exactly the limit unchanged", () => {
    const text = "x".repeat(2000);
    expect(truncateContent(text)).toBe(text);
  });

  test("truncates text beyond the limit", () => {
    const text = "x".repeat(2500);
    const result = truncateContent(text);
    expect(result).toContain("x".repeat(2000));
    expect(result).toContain("[...truncated, full length: 2500 chars]");
  });

  test("respects custom limit", () => {
    const text = "x".repeat(100);
    const result = truncateContent(text, 50);
    expect(result).toContain("x".repeat(50));
    expect(result).toContain("[...truncated, full length: 100 chars]");
  });
});

// ---------------------------------------------------------------------------
// formatSessionList
// ---------------------------------------------------------------------------

const makeSession = (overrides: Partial<{
  id: string;
  title: string;
  updated_at: number;
  json: string;
  is_discarded: number;
}> = {}) => ({
  id: overrides.id ?? "abc-123",
  title: overrides.title ?? "Test Session",
  updated_at: overrides.updated_at ?? Date.now(),
  json: overrides.json ?? JSON.stringify({ events: [{ speaker: "user", payload: { content: "hi" } }] }),
  is_discarded: overrides.is_discarded ?? 0,
});

describe("formatSessionList", () => {
  test("formats active sessions as numbered list", () => {
    const sessions = [makeSession({ id: "id-1", title: "First" })];
    const result = formatSessionList(sessions, false);
    expect(result).toContain('1. "First"');
    expect(result).toContain("ID: id-1");
    expect(result).toContain("1 messages");
  });

  test("filters out discarded sessions when include_discarded=false", () => {
    const sessions = [
      makeSession({ id: "id-1", title: "Active" }),
      makeSession({ id: "id-2", title: "Deleted", is_discarded: 1 }),
    ];
    const result = formatSessionList(sessions, false);
    expect(result).toContain("Active");
    expect(result).not.toContain("Deleted");
  });

  test("includes discarded sessions when include_discarded=true", () => {
    const sessions = [
      makeSession({ id: "id-1", title: "Active" }),
      makeSession({ id: "id-2", title: "Deleted", is_discarded: 1 }),
    ];
    const result = formatSessionList(sessions, true);
    expect(result).toContain("Active");
    expect(result).toContain("Deleted");
    expect(result).toContain("[DISCARDED]");
  });

  test("sorts by updated_at descending", () => {
    const sessions = [
      makeSession({ id: "old", title: "Old", updated_at: 1000 }),
      makeSession({ id: "new", title: "New", updated_at: 2000 }),
    ];
    const result = formatSessionList(sessions, false);
    const newIdx = result.indexOf("New");
    const oldIdx = result.indexOf("Old");
    expect(newIdx).toBeLessThan(oldIdx);
  });

  test("returns 'no sessions' message for empty list", () => {
    const result = formatSessionList([], false);
    expect(result).toContain("No agent sessions found");
  });

  test("handles session with malformed json", () => {
    const sessions = [makeSession({ json: "not-json" })];
    const result = formatSessionList(sessions, false);
    expect(result).toContain("0 messages");
  });

  test("handles session with empty events array", () => {
    const sessions = [makeSession({ json: JSON.stringify({ events: [] }) })];
    const result = formatSessionList(sessions, false);
    expect(result).toContain("0 messages");
  });
});

// ---------------------------------------------------------------------------
// formatTranscript
// ---------------------------------------------------------------------------

describe("formatTranscript", () => {
  test("formats a conversation with user and AI messages", () => {
    const session = makeSession({
      title: "Test Chat",
      json: JSON.stringify({
        events: [
          { speaker: "user", payload: { content: "What is email?" } },
          { speaker: "agent", payload: { content: "Email is electronic mail." } },
        ],
        updatedAt: "2026-03-07T12:00:00Z",
      }),
    });
    const result = formatTranscript(session);
    expect(result).toContain("# Test Chat");
    expect(result).toContain("**You:** What is email?");
    expect(result).toContain("**AI:** Email is electronic mail.");
  });

  test("strips thinking blocks from AI messages", () => {
    const session = makeSession({
      json: JSON.stringify({
        events: [
          { speaker: "agent", payload: { content: "<thinking>internal</thinking>Visible answer" } },
        ],
        updatedAt: "2026-03-07T12:00:00Z",
      }),
    });
    const result = formatTranscript(session);
    expect(result).toContain("Visible answer");
    expect(result).not.toContain("internal");
    expect(result).not.toContain("<thinking>");
  });

  test("truncates long messages", () => {
    const longContent = "x".repeat(3000);
    const session = makeSession({
      json: JSON.stringify({
        events: [
          { speaker: "agent", payload: { content: longContent } },
        ],
        updatedAt: "2026-03-07T12:00:00Z",
      }),
    });
    const result = formatTranscript(session);
    expect(result).toContain("[...truncated, full length: 3000 chars]");
  });

  test("handles empty events array", () => {
    const session = makeSession({
      title: "Empty Chat",
      json: JSON.stringify({ events: [] }),
    });
    const result = formatTranscript(session);
    expect(result).toContain("no messages");
  });

  test("handles malformed json", () => {
    const session = makeSession({ title: "Bad Data", json: "{invalid" });
    const result = formatTranscript(session);
    expect(result).toContain("could not parse");
  });

  test("handles missing payload content gracefully", () => {
    const session = makeSession({
      json: JSON.stringify({
        events: [
          { speaker: "user", payload: {} },
        ],
        updatedAt: "2026-03-07T12:00:00Z",
      }),
    });
    const result = formatTranscript(session);
    expect(result).toContain("**You:**");
  });
});
