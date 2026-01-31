import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import {
  connectToSuperhuman,
  disconnect,
  type SuperhumanConnection,
} from "../superhuman-api";
import { listInbox } from "../inbox";
import { markAsRead, markAsUnread } from "../read-status";

const CDP_PORT = 9333;

describe("read-status", () => {
  let conn: SuperhumanConnection | null = null;
  let testThreadId: string | null = null;

  beforeAll(async () => {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error(
        "Could not connect to Superhuman. Make sure it is running with --remote-debugging-port=9333"
      );
    }

    // Get a thread to test with
    const threads = await listInbox(conn, { limit: 20 });
    if (threads.length > 0) {
      testThreadId = threads[0].id;
    }
  });

  afterAll(async () => {
    if (conn) {
      await disconnect(conn);
    }
  });

  test("markAsRead removes UNREAD label from thread", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");

    // First mark as unread to ensure we have a known state
    await markAsUnread(conn, testThreadId);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Now mark as read
    const result = await markAsRead(conn, testThreadId);
    expect(result.success).toBe(true);

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify the thread no longer has UNREAD label
    const { Runtime } = conn;
    const checkResult = await Runtime.evaluate({
      expression: `
        (() => {
          const thread = window.GoogleAccount?.threads?.identityMap?.get?.(${JSON.stringify(testThreadId)});
          return thread?._threadModel?.labelIds || [];
        })()
      `,
      returnByValue: true,
    });

    const labelIds = checkResult.result.value as string[];
    expect(labelIds.includes("UNREAD")).toBe(false);
  });

  test("markAsUnread adds UNREAD label to thread", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");

    // First mark as read to ensure we have a known state
    await markAsRead(conn, testThreadId);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Now mark as unread
    const result = await markAsUnread(conn, testThreadId);
    expect(result.success).toBe(true);

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify the thread has UNREAD label
    const { Runtime } = conn;
    const checkResult = await Runtime.evaluate({
      expression: `
        (() => {
          const thread = window.GoogleAccount?.threads?.identityMap?.get?.(${JSON.stringify(testThreadId)});
          return thread?._threadModel?.labelIds || [];
        })()
      `,
      returnByValue: true,
    });

    const labelIds = checkResult.result.value as string[];
    expect(labelIds.includes("UNREAD")).toBe(true);
  });

  test("markAsRead handles already-read thread gracefully", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");

    // Mark as read twice - should not error
    await markAsRead(conn, testThreadId);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = await markAsRead(conn, testThreadId);
    expect(result.success).toBe(true);
  });

  test("markAsUnread handles already-unread thread gracefully", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");

    // Mark as unread twice - should not error
    await markAsUnread(conn, testThreadId);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = await markAsUnread(conn, testThreadId);
    expect(result.success).toBe(true);
  });
});
