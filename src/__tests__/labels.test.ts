import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import {
  connectToSuperhuman,
  disconnect,
  type SuperhumanConnection,
} from "../superhuman-api";
import { listInbox } from "../inbox";
import { listLabels, getThreadLabels, addLabel, removeLabel, type Label } from "../labels";

const CDP_PORT = 9333;

describe("labels", () => {
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

  test("listLabels returns array of labels", async () => {
    if (!conn) throw new Error("No connection");

    const labels = await listLabels(conn);

    expect(Array.isArray(labels)).toBe(true);
    expect(labels.length).toBeGreaterThan(0);

    // Check label structure
    const firstLabel = labels[0];
    expect(firstLabel).toHaveProperty("id");
    expect(firstLabel).toHaveProperty("name");
  });

  test("listLabels includes system labels", async () => {
    if (!conn) throw new Error("No connection");

    const labels = await listLabels(conn);
    const labelNames = labels.map((l) => l.name);

    // Should include common system labels
    expect(labelNames.some((name) => name === "INBOX" || name === "Inbox")).toBe(true);
  });

  test("getThreadLabels returns labels for a specific thread", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");

    const labels = await getThreadLabels(conn, testThreadId);

    expect(Array.isArray(labels)).toBe(true);
    // Most inbox threads should have at least one label
    expect(labels.length).toBeGreaterThan(0);
  });

  test("addLabel adds a label to a thread", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");

    // Get available labels first
    const allLabels = await listLabels(conn);

    // Find a user label (not a system label) to test with
    const userLabel = allLabels.find(
      (l) => l.id.startsWith("Label_") && !l.name.startsWith("SH_")
    );

    if (!userLabel) {
      // Skip test if no user labels exist
      console.log("No user labels available for testing addLabel");
      return;
    }

    // Get current labels
    const labelsBefore = await getThreadLabels(conn, testThreadId);
    const hadLabel = labelsBefore.some((l) => l.id === userLabel.id);

    // If already has the label, remove it first
    if (hadLabel) {
      await removeLabel(conn, testThreadId, userLabel.id);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Add the label
    const result = await addLabel(conn, testThreadId, userLabel.id);
    expect(result.success).toBe(true);

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify the label was added
    const labelsAfter = await getThreadLabels(conn, testThreadId);
    expect(labelsAfter.some((l) => l.id === userLabel.id)).toBe(true);

    // Clean up - remove the label if we added it
    if (!hadLabel) {
      await removeLabel(conn, testThreadId, userLabel.id);
    }
  });

  test("removeLabel removes a label from a thread", async () => {
    if (!conn) throw new Error("No connection");
    if (!testThreadId) throw new Error("No test thread available");

    // Get available labels first
    const allLabels = await listLabels(conn);

    // Find a user label to test with
    const userLabel = allLabels.find(
      (l) => l.id.startsWith("Label_") && !l.name.startsWith("SH_")
    );

    if (!userLabel) {
      // Skip test if no user labels exist
      console.log("No user labels available for testing removeLabel");
      return;
    }

    // First add the label to ensure it exists on the thread
    await addLabel(conn, testThreadId, userLabel.id);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Now remove it
    const result = await removeLabel(conn, testThreadId, userLabel.id);
    expect(result.success).toBe(true);

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify the label was removed
    const labelsAfter = await getThreadLabels(conn, testThreadId);
    expect(labelsAfter.some((l) => l.id === userLabel.id)).toBe(false);
  });
});
