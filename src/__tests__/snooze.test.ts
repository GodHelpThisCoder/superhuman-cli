import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import {
  connectToSuperhuman,
  disconnect,
  type SuperhumanConnection,
} from "../superhuman-api";
import { listInbox } from "../inbox";
import {
  snoozeThread,
  unsnoozeThread,
  listSnoozed,
  parseSnoozeTime,
  getSnoozeTimeFromPreset,
} from "../snooze";

const CDP_PORT = 9333;

describe("snooze", () => {
  let conn: SuperhumanConnection | null = null;
  let testThreadId: string | null = null;
  let testReminderId: string | null = null;

  beforeAll(async () => {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error(
        "Could not connect to Superhuman. Make sure it is running with --remote-debugging-port=9333"
      );
    }

    // Get a thread to test with - filter out drafts which have invalid thread IDs
    const threads = await listInbox(conn, { limit: 20 });
    const validThread = threads.find((t) => !t.id.startsWith("draft"));
    if (validThread) {
      testThreadId = validThread.id;
    }
  });

  afterAll(async () => {
    // Clean up: unsnooze the thread if it was snoozed
    if (conn && testThreadId && testReminderId) {
      try {
        await unsnoozeThread(conn, testThreadId, testReminderId);
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    if (conn) {
      await disconnect(conn);
    }
  });

  test("parseSnoozeTime parses preset times", () => {
    const now = new Date();
    const tomorrow = parseSnoozeTime("tomorrow");
    expect(tomorrow.getHours()).toBe(9);

    // Tomorrow should be 1 day after now
    const expectedTomorrow = new Date(now);
    expectedTomorrow.setDate(now.getDate() + 1);
    expect(tomorrow.getDate()).toBe(expectedTomorrow.getDate());

    const nextWeek = parseSnoozeTime("next-week");
    expect(nextWeek.getHours()).toBe(9);
    // Should be a Monday
    expect(nextWeek.getDay()).toBe(1);
  });

  test("parseSnoozeTime parses ISO datetime", () => {
    const isoDate = "2025-06-15T14:30:00.000Z";
    const parsed = parseSnoozeTime(isoDate);
    expect(parsed.toISOString()).toBe(isoDate);
  });

  test("getSnoozeTimeFromPreset returns correct times", () => {
    const evening = getSnoozeTimeFromPreset("evening");
    expect(evening.getHours()).toBe(18);

    const weekend = getSnoozeTimeFromPreset("weekend");
    expect(weekend.getDay()).toBe(6); // Saturday
  });

  test("snoozeThread snoozes a thread", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");

    // Snooze the thread until tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    const result = await snoozeThread(conn, testThreadId, tomorrow);
    expect(result.success).toBe(true);
    expect(result.reminderId).toBeDefined();

    // Save the reminder ID for cleanup and unsnooze test
    testReminderId = result.reminderId || null;

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  test("unsnoozeThread unsnoozes a thread", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");
    if (!testReminderId) throw new Error("No reminder ID from snooze test");

    // Unsnooze the thread
    const result = await unsnoozeThread(conn, testThreadId, testReminderId);
    expect(result.success).toBe(true);

    // Clear the reminder ID since we've unsnoozed
    testReminderId = null;

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  test("listSnoozed returns an array", async () => {
    if (!conn) throw new Error("No connection");

    // List snoozed threads
    const snoozedThreads = await listSnoozed(conn);

    // Verify we got an array
    expect(Array.isArray(snoozedThreads)).toBe(true);
  });
});
