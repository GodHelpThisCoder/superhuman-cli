import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import {
  connectToSuperhuman,
  disconnect,
  type SuperhumanConnection,
} from "../superhuman-api";
import { listInbox } from "../inbox";
import { getThreadLabels, starThread, unstarThread, listStarred } from "../labels";

const CDP_PORT = 9333;

describe("star", () => {
  let conn: SuperhumanConnection | null = null;
  let testThreadId: string | null = null;
  let isMicrosoft: boolean = false;

  beforeAll(async () => {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error(
        "Could not connect to Superhuman. Make sure it is running with --remote-debugging-port=9333"
      );
    }

    // Check if this is a Microsoft account
    const { Runtime } = conn;
    const accountCheck = await Runtime.evaluate({
      expression: `(async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        return { isMicrosoft: !!di?.get?.('isMicrosoft') };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    isMicrosoft = (accountCheck.result.value as { isMicrosoft: boolean })?.isMicrosoft ?? false;
    console.log("Account type:", isMicrosoft ? "Microsoft" : "Gmail");

    // Get a thread to test with - filter out drafts which have invalid Gmail thread IDs
    const threads = await listInbox(conn, { limit: 20 });
    const validThread = threads.find((t) => !t.id.startsWith("draft"));
    if (validThread) {
      testThreadId = validThread.id;
    }
  });

  afterAll(async () => {
    if (conn) {
      await disconnect(conn);
    }
  });

  test("starThread stars a thread", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");

    // Unstar first to ensure clean state
    await unstarThread(conn, testThreadId);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Star the thread
    const result = await starThread(conn, testThreadId);
    expect(result.success).toBe(true);

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // For Gmail, verify the STARRED label was added
    if (!isMicrosoft) {
      const labelsAfter = await getThreadLabels(conn, testThreadId);
      expect(labelsAfter.some((l) => l.id === "STARRED")).toBe(true);
    }

    // Clean up
    await unstarThread(conn, testThreadId);
  });

  test("unstarThread unstars a thread", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");

    // First star the thread
    const starResult = await starThread(conn, testThreadId);
    expect(starResult.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Now unstar it
    const result = await unstarThread(conn, testThreadId);
    expect(result.success).toBe(true);

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // For Gmail, verify the STARRED label was removed
    if (!isMicrosoft) {
      const labelsAfter = await getThreadLabels(conn, testThreadId);
      expect(labelsAfter.some((l) => l.id === "STARRED")).toBe(false);
    }
  });

  test("listStarred returns starred threads", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");

    // First star the thread
    const starResult = await starThread(conn, testThreadId);
    expect(starResult.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // List starred threads
    const starredThreads = await listStarred(conn);

    // Verify we got an array
    expect(Array.isArray(starredThreads)).toBe(true);

    // For Gmail, verify the thread is in the starred list
    // (For Microsoft, the filter query might not work as expected)
    if (!isMicrosoft) {
      expect(starredThreads.some((t) => t.id === testThreadId)).toBe(true);
    }

    // Clean up - unstar the thread
    await unstarThread(conn, testThreadId);
  });
});
