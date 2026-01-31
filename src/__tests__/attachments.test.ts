import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import {
  connectToSuperhuman,
  disconnect,
  type SuperhumanConnection,
} from "../superhuman-api";
import { listInbox } from "../inbox";
import { listAttachments, downloadAttachment, addAttachment } from "../attachments";

const CDP_PORT = 9333;

describe("attachments", () => {
  let conn: SuperhumanConnection | null = null;

  beforeAll(async () => {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error(
        "Could not connect to Superhuman. Make sure it is running with --remote-debugging-port=9333"
      );
    }
  });

  afterAll(async () => {
    if (conn) {
      await disconnect(conn);
    }
  });

  test("listAttachments returns attachment metadata from message", async () => {
    if (!conn) throw new Error("No connection");

    // Get threads from inbox, filter out drafts
    const threads = await listInbox(conn, { limit: 20 });
    const realThreads = threads.filter(t => !t.id.startsWith("draft"));
    expect(realThreads.length).toBeGreaterThan(0);

    const threadId = realThreads[0].id;
    const attachments = await listAttachments(conn, threadId);

    // Should return array (may be empty if no attachments)
    expect(Array.isArray(attachments)).toBe(true);

    // If there are attachments, check structure
    if (attachments.length > 0) {
      const att = attachments[0];
      expect(att.name).toBeDefined();
      expect(att.mimeType).toBeDefined();
      expect(att.attachmentId).toBeDefined();
    }
  });

  test("downloadAttachment returns base64 content", async () => {
    if (!conn) throw new Error("No connection");

    // Get threads and search for one with attachments (skip drafts)
    const threads = await listInbox(conn, { limit: 50 });
    const realThreads = threads.filter(t => !t.id.startsWith("draft"));

    let attachments: Awaited<ReturnType<typeof listAttachments>> = [];
    let threadId = "";

    for (const thread of realThreads) {
      const threadAttachments = await listAttachments(conn, thread.id);
      // Only use attachments with valid attachmentId (real email attachments)
      const validAttachments = threadAttachments.filter(a => a.attachmentId);
      if (validAttachments.length > 0) {
        attachments = validAttachments;
        threadId = thread.id;
        console.log(`Found ${validAttachments.length} attachment(s) in thread ${threadId}`);
        break;
      }
    }

    // Skip if no attachments found in any thread
    if (attachments.length === 0) {
      console.log(
        "No attachments found in first 50 threads, skipping download test"
      );
      return;
    }

    const att = attachments[0];
    console.log(`Downloading attachment: ${att.name} (${att.mimeType})`);

    const content = await downloadAttachment(
      conn,
      att.messageId,
      att.attachmentId,
      att.threadId,
      att.mimeType
    );

    expect(content).toBeDefined();
    expect(content.data).toBeDefined();
    expect(typeof content.data).toBe("string");
    expect(content.data.length).toBeGreaterThan(0);
    expect(content.size).toBeGreaterThan(0);
    console.log(`Downloaded ${content.size} bytes (${att.name})`);
  });

  test("addAttachment adds file to draft", async () => {
    if (!conn) throw new Error("No connection");

    // Import openCompose and closeCompose
    const { openCompose, closeCompose } = await import("../superhuman-api");

    // Open compose to create a draft
    const draftKey = await openCompose(conn);
    expect(draftKey).toBeDefined();

    try {
      // Create a simple test file content (base64 encoded "Hello, World!")
      const testContent = Buffer.from("Hello, World!").toString("base64");
      const testFilename = "test-attachment.txt";
      const testMimeType = "text/plain";

      // Add attachment
      const result = await addAttachment(conn, testFilename, testContent, testMimeType);

      expect(result.success).toBe(true);

      // Verify attachment was added by listing draft attachments
      if (result.success) {
        // Small delay for state to update
        await new Promise(r => setTimeout(r, 500));

        // Check the draft has the attachment
        const { Runtime } = conn;
        const checkResult = await Runtime.evaluate({
          expression: `
            (() => {
              const cfc = window.ViewState?._composeFormController;
              if (!cfc) return { count: 0 };
              const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
              if (!draftKey) return { count: 0 };
              const ctrl = cfc[draftKey];
              const draft = ctrl?.state?.draft;
              const attachments = draft?.getAttachments?.() || draft?._attachments || [];
              return { count: attachments.length };
            })()
          `,
          returnByValue: true
        });

        const { count } = checkResult.result.value as { count: number };
        expect(count).toBeGreaterThan(0);
      }
    } finally {
      // Clean up - close compose without saving
      await closeCompose(conn);
    }
  });
});
