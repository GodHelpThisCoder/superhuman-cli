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

  test("starThread adds STARRED label to a thread", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");
    if (isMicrosoft) {
      console.log("Skipping star test - Microsoft accounts don't support starring via labels");
      return;
    }

    // Get current labels to check if already starred
    const labelsBefore = await getThreadLabels(conn, testThreadId);
    const wasStarred = labelsBefore.some((l) => l.id === "STARRED");

    // If already starred, unstar first
    if (wasStarred) {
      await unstarThread(conn, testThreadId);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Star the thread
    const result = await starThread(conn, testThreadId);
    expect(result.success).toBe(true);

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify the STARRED label was added
    const labelsAfter = await getThreadLabels(conn, testThreadId);
    expect(labelsAfter.some((l) => l.id === "STARRED")).toBe(true);

    // Clean up - unstar if we starred it
    if (!wasStarred) {
      await unstarThread(conn, testThreadId);
    }
  });

  test("unstarThread removes STARRED label from a thread", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");
    if (isMicrosoft) {
      console.log("Skipping unstar test - Microsoft accounts don't support starring via labels");
      return;
    }

    // First star the thread to ensure it has the STARRED label
    const starResult = await starThread(conn, testThreadId);
    expect(starResult.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify it's starred before unstarring
    const labelsBefore = await getThreadLabels(conn, testThreadId);
    expect(labelsBefore.some((l) => l.id === "STARRED")).toBe(true);

    // Now unstar it
    const result = await unstarThread(conn, testThreadId);
    expect(result.success).toBe(true);

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify the STARRED label was removed
    const labelsAfter = await getThreadLabels(conn, testThreadId);
    expect(labelsAfter.some((l) => l.id === "STARRED")).toBe(false);
  });

  test("listStarred returns starred threads", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");
    if (isMicrosoft) {
      console.log("Skipping listStarred test - Microsoft accounts don't support starring via labels");
      return;
    }

    // First star the thread
    const starResult = await starThread(conn, testThreadId);
    expect(starResult.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // List starred threads
    const starredThreads = await listStarred(conn);

    // Verify the thread is in the starred list
    expect(Array.isArray(starredThreads)).toBe(true);
    expect(starredThreads.some((t) => t.id === testThreadId)).toBe(true);

    // Clean up - unstar the thread
    await unstarThread(conn, testThreadId);
  });
});
