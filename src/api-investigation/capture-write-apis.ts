/**
 * Superhuman Write API Capture Script
 *
 * Uses CDP Network domain to capture HTTP requests when performing write operations.
 * Records request/response details for documentation.
 */

import CDP from "chrome-remote-interface";
import { connectToSuperhuman, type SuperhumanConnection } from "../superhuman-api";

interface CapturedRequest {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  timestamp: number;
  operation: string;
}

interface CapturedResponse {
  requestId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  timestamp: number;
}

interface CapturedOperation {
  operation: string;
  request: CapturedRequest;
  response?: CapturedResponse;
}

const capturedRequests = new Map<string, CapturedRequest>();
const capturedResponses = new Map<string, CapturedResponse>();
const completedOperations: CapturedOperation[] = [];
let currentOperation = "unknown";

// Filter for interesting API endpoints
function isInterestingRequest(url: string): boolean {
  const patterns = [
    "googleapis.com/gmail",
    "googleapis.com/batch",
    "graph.microsoft.com",
    "mail.superhuman.com/api",
    "mail.superhuman.com/graphql",
    "superhuman.com/api",
    "superhuman.com/v1",
    "superhuman.com/v2",
    "/drafts",
    "/messages",
    "/threads",
    "/labels",
    "/send",
  ];
  return patterns.some((p) => url.includes(p));
}

async function setupNetworkCapture(conn: SuperhumanConnection): Promise<void> {
  const { Network, client } = conn;

  await Network.enable({
    maxPostDataSize: 65536,
  });

  // Capture requests
  client.on("Network.requestWillBeSent", (params: CDP.Network.RequestWillBeSentEvent) => {
    const { requestId, request, timestamp } = params;
    if (!isInterestingRequest(request.url)) return;

    capturedRequests.set(requestId, {
      requestId,
      url: request.url,
      method: request.method,
      headers: request.headers as Record<string, string>,
      postData: request.postData,
      timestamp,
      operation: currentOperation,
    });

    console.log(`[${currentOperation}] Request: ${request.method} ${request.url.substring(0, 100)}...`);
  });

  // Capture response headers
  client.on("Network.responseReceived", (params: CDP.Network.ResponseReceivedEvent) => {
    const { requestId, response, timestamp } = params;
    if (!capturedRequests.has(requestId)) return;

    capturedResponses.set(requestId, {
      requestId,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers as Record<string, string>,
      timestamp,
    });
  });

  // Capture response body when loading finishes
  client.on("Network.loadingFinished", async (params: CDP.Network.LoadingFinishedEvent) => {
    const { requestId } = params;
    const request = capturedRequests.get(requestId);
    const response = capturedResponses.get(requestId);

    if (!request) return;

    // Try to get response body
    if (response) {
      try {
        const bodyResult = await Network.getResponseBody({ requestId });
        response.body = bodyResult.body;
      } catch {
        // Body may not be available
      }
    }

    // Record completed operation
    completedOperations.push({
      operation: request.operation,
      request,
      response,
    });

    console.log(`[${request.operation}] Response: ${response?.status || "N/A"}`);

    capturedRequests.delete(requestId);
    capturedResponses.delete(requestId);
  });

  console.log("Network capture enabled");
}

async function performComposeAndSave(conn: SuperhumanConnection): Promise<void> {
  currentOperation = "compose-draft";
  console.log("\n=== Testing Compose Draft ===");

  const { Runtime } = conn;

  // Open compose form
  await Runtime.evaluate({
    expression: `document.querySelector('.ThreadListView-compose')?.click()`,
  });
  await new Promise((r) => setTimeout(r, 3000));

  // Set draft content
  await Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return false;
        const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
        if (!draftKey) return false;
        const ctrl = cfc[draftKey];
        ctrl.setSubject('API Test - ${new Date().toISOString()}');
        ctrl._updateDraft({ body: '<p>This is a test email for API capture.</p>' });
        return true;
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 2000));

  // Save draft (triggers API call)
  currentOperation = "save-draft";
  await Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return false;
        const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
        if (!draftKey) return false;
        const ctrl = cfc[draftKey];
        ctrl._saveDraftAsync();
        return true;
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 3000));

  // Close compose
  const { Input } = conn;
  await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });
  await new Promise((r) => setTimeout(r, 1000));
}

async function performArchive(conn: SuperhumanConnection): Promise<void> {
  currentOperation = "archive";
  console.log("\n=== Testing Archive ===");

  const { Runtime } = conn;

  // Get first thread ID from inbox
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const threadList = window.ViewState?.threadListState?._list?._sortedList?.sorted;

        if (!threadList || threadList.length === 0) {
          return { error: "No threads available" };
        }

        const threadRef = threadList[0];
        const thread = ga?.threads?.identityMap?.get?.(threadRef.id);
        if (!thread?._threadModel) {
          return { error: "Thread not found" };
        }

        const model = thread._threadModel;
        const threadId = model.id;

        // Check if Gmail or Microsoft
        const isMicrosoft = di?.get?.('isMicrosoft');

        if (isMicrosoft) {
          const msgraph = di?.get?.('msgraph');
          const folders = await msgraph.getAllFolders();
          const archiveFolder = folders?.find(f => f.displayName?.toLowerCase() === 'archive');
          const messageIds = model.messageIds;

          const moveRequests = messageIds.map(messageId => ({
            messageId,
            destinationFolderId: archiveFolder.id
          }));

          await msgraph.moveMessages(moveRequests);
        } else {
          const gmail = di?.get?.('gmail');
          await gmail.changeLabelsPerThread(threadId, [], ['INBOX']);
        }

        return { success: true, threadId };
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  await new Promise((r) => setTimeout(r, 3000));
  console.log("Archive result:", result.result.value);
}

async function performLabel(conn: SuperhumanConnection): Promise<void> {
  currentOperation = "add-label";
  console.log("\n=== Testing Add Label ===");

  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const threadList = window.ViewState?.threadListState?._list?._sortedList?.sorted;

        if (!threadList || threadList.length === 0) {
          return { error: "No threads available" };
        }

        const threadRef = threadList[0];
        const thread = ga?.threads?.identityMap?.get?.(threadRef.id);
        if (!thread?._threadModel) {
          return { error: "Thread not found" };
        }

        const model = thread._threadModel;
        const threadId = model.id;

        const isMicrosoft = di?.get?.('isMicrosoft');

        // Get available labels
        let labelId;
        if (isMicrosoft) {
          return { error: "Label test skipped for Microsoft" };
        } else {
          const gmail = di?.get?.('gmail');
          const labels = await gmail.getLabels();
          const userLabel = labels?.find(l => l.type === 'user');
          if (!userLabel) {
            return { error: "No user labels found" };
          }
          labelId = userLabel.id;

          // Add the label
          await gmail.changeLabelsPerThread(threadId, [labelId], []);
        }

        return { success: true, threadId, labelId };
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  await new Promise((r) => setTimeout(r, 3000));
  console.log("Label result:", result.result.value);
}

async function performStar(conn: SuperhumanConnection): Promise<void> {
  currentOperation = "star";
  console.log("\n=== Testing Star ===");

  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const threadList = window.ViewState?.threadListState?._list?._sortedList?.sorted;

        if (!threadList || threadList.length === 0) {
          return { error: "No threads available" };
        }

        const threadRef = threadList[0];
        const thread = ga?.threads?.identityMap?.get?.(threadRef.id);
        if (!thread?._threadModel) {
          return { error: "Thread not found" };
        }

        const model = thread._threadModel;
        const threadId = model.id;

        const isMicrosoft = di?.get?.('isMicrosoft');

        if (isMicrosoft) {
          const msgraph = di?.get?.('msgraph');
          const messageIds = model.messageIds;
          await msgraph.updateMessages(
            messageIds,
            { flag: { flagStatus: "flagged" } },
            { action: "flag" }
          );
        } else {
          const gmail = di?.get?.('gmail');
          await gmail.changeLabelsPerThread(threadId, ["STARRED"], []);
        }

        return { success: true, threadId };
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  await new Promise((r) => setTimeout(r, 3000));
  console.log("Star result:", result.result.value);
}

async function performMarkRead(conn: SuperhumanConnection): Promise<void> {
  currentOperation = "mark-read";
  console.log("\n=== Testing Mark Read ===");

  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const threadList = window.ViewState?.threadListState?._list?._sortedList?.sorted;

        if (!threadList || threadList.length === 0) {
          return { error: "No threads available" };
        }

        const threadRef = threadList[0];
        const thread = ga?.threads?.identityMap?.get?.(threadRef.id);
        if (!thread?._threadModel) {
          return { error: "Thread not found" };
        }

        const model = thread._threadModel;
        const threadId = model.id;

        const isMicrosoft = di?.get?.('isMicrosoft');

        if (isMicrosoft) {
          const msgraph = di?.get?.('msgraph');
          const messageIds = model.messageIds;
          await msgraph.updateMessages(messageIds, { isRead: true });
        } else {
          const gmail = di?.get?.('gmail');
          await gmail.changeLabelsPerThread(threadId, [], ["UNREAD"]);
        }

        return { success: true, threadId };
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  await new Promise((r) => setTimeout(r, 3000));
  console.log("Mark read result:", result.result.value);
}

async function performSnooze(conn: SuperhumanConnection): Promise<void> {
  currentOperation = "snooze";
  console.log("\n=== Testing Snooze ===");

  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const backend = ga?.backend;
        const threadList = window.ViewState?.threadListState?._list?._sortedList?.sorted;

        if (!backend) {
          return { error: "Backend not found" };
        }

        if (!threadList || threadList.length === 0) {
          return { error: "No threads available" };
        }

        const threadRef = threadList[0];
        const thread = ga?.threads?.identityMap?.get?.(threadRef.id);
        if (!thread?._threadModel) {
          return { error: "Thread not found" };
        }

        const model = thread._threadModel;
        const threadId = model.id;
        const messageIds = model.messageIds || [];

        // Generate UUID
        function generateUUID() {
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        }

        const reminderId = generateUUID();
        const triggerAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // Tomorrow

        const reminderData = {
          attributes: {
            reminderId,
            threadId,
            messageIds,
            triggerAt,
            clientCreatedAt: new Date().toISOString(),
          },
          toJson: function() {
            return {
              reminderId: this.attributes.reminderId,
              threadId: this.attributes.threadId,
              messageIds: this.attributes.messageIds,
              triggerAt: this.attributes.triggerAt,
              clientCreatedAt: this.attributes.clientCreatedAt,
            };
          }
        };

        try {
          await backend.createReminder(reminderData, { markDone: false, moveToInbox: false });
          return { success: true, threadId, reminderId };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  await new Promise((r) => setTimeout(r, 3000));
  console.log("Snooze result:", result.result.value);
}

function generateMarkdown(): string {
  const lines: string[] = [
    "# Superhuman Write Operations API Documentation",
    "",
    `> Generated: ${new Date().toISOString()}`,
    "",
    "This document captures HTTP requests made by Superhuman when performing write operations.",
    "",
    "## Overview",
    "",
    "Superhuman uses a combination of:",
    "- **Gmail API** for Google accounts (`googleapis.com/gmail`)",
    "- **Microsoft Graph API** for Outlook accounts (`graph.microsoft.com`)",
    "- **Superhuman Backend API** for features like snooze/reminders",
    "",
    "---",
    "",
  ];

  // Group by operation
  const byOperation = new Map<string, CapturedOperation[]>();
  for (const op of completedOperations) {
    const existing = byOperation.get(op.operation) || [];
    existing.push(op);
    byOperation.set(op.operation, existing);
  }

  for (const [operation, ops] of byOperation) {
    lines.push(`## ${formatOperationName(operation)}`);
    lines.push("");

    for (const op of ops) {
      const { request, response } = op;
      const urlObj = new URL(request.url);

      lines.push(`### ${request.method} ${urlObj.pathname}`);
      lines.push("");
      lines.push(`**Full URL:** \`${request.url}\``);
      lines.push("");

      // Headers (filter sensitive ones)
      lines.push("**Request Headers:**");
      lines.push("```");
      const safeHeaders = ["content-type", "accept", "x-goog-api-client", "x-requested-with"];
      for (const [key, value] of Object.entries(request.headers)) {
        if (safeHeaders.includes(key.toLowerCase())) {
          lines.push(`${key}: ${value}`);
        } else if (key.toLowerCase() === "authorization") {
          lines.push(`${key}: Bearer [REDACTED]`);
        }
      }
      lines.push("```");
      lines.push("");

      // Request body
      if (request.postData) {
        lines.push("**Request Body:**");
        lines.push("```json");
        try {
          const parsed = JSON.parse(request.postData);
          lines.push(JSON.stringify(parsed, null, 2));
        } catch {
          lines.push(request.postData);
        }
        lines.push("```");
        lines.push("");
      }

      // Response
      if (response) {
        lines.push(`**Response Status:** ${response.status} ${response.statusText}`);
        lines.push("");

        if (response.body) {
          lines.push("**Response Body:**");
          lines.push("```json");
          try {
            const parsed = JSON.parse(response.body);
            // Truncate large responses
            const str = JSON.stringify(parsed, null, 2);
            lines.push(str.length > 2000 ? str.substring(0, 2000) + "\n... (truncated)" : str);
          } catch {
            lines.push(
              response.body.length > 2000
                ? response.body.substring(0, 2000) + "\n... (truncated)"
                : response.body
            );
          }
          lines.push("```");
          lines.push("");
        }
      }

      lines.push("---");
      lines.push("");
    }
  }

  // Summary section
  lines.push("## API Pattern Summary");
  lines.push("");
  lines.push("### Gmail API Endpoints");
  lines.push("");
  lines.push("| Operation | Method | Endpoint |");
  lines.push("|-----------|--------|----------|");
  lines.push("| Archive | POST | `/gmail/v1/users/me/threads/{threadId}/modify` |");
  lines.push("| Add Label | POST | `/gmail/v1/users/me/threads/{threadId}/modify` |");
  lines.push("| Remove Label | POST | `/gmail/v1/users/me/threads/{threadId}/modify` |");
  lines.push("| Star | POST | `/gmail/v1/users/me/threads/{threadId}/modify` |");
  lines.push("| Mark Read | POST | `/gmail/v1/users/me/threads/{threadId}/modify` |");
  lines.push("| Save Draft | POST | `/gmail/v1/users/me/drafts` |");
  lines.push("| Update Draft | PUT | `/gmail/v1/users/me/drafts/{draftId}` |");
  lines.push("| Send | POST | `/gmail/v1/users/me/messages/send` |");
  lines.push("");
  lines.push("### Microsoft Graph Endpoints");
  lines.push("");
  lines.push("| Operation | Method | Endpoint |");
  lines.push("|-----------|--------|----------|");
  lines.push("| Archive | POST | `/v1.0/me/messages/{messageId}/move` |");
  lines.push("| Star (Flag) | PATCH | `/v1.0/me/messages/{messageId}` |");
  lines.push("| Mark Read | PATCH | `/v1.0/me/messages/{messageId}` |");
  lines.push("| Save Draft | POST | `/v1.0/me/messages` |");
  lines.push("| Send | POST | `/v1.0/me/sendMail` |");
  lines.push("");
  lines.push("### Superhuman Backend");
  lines.push("");
  lines.push("| Operation | Method | Endpoint |");
  lines.push("|-----------|--------|----------|");
  lines.push("| Snooze | POST | `mail.superhuman.com/api/reminders` |");
  lines.push("| Unsnooze | DELETE | `mail.superhuman.com/api/reminders/{reminderId}` |");
  lines.push("");

  return lines.join("\n");
}

function formatOperationName(operation: string): string {
  return operation
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function main(): Promise<void> {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman();

  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  console.log("Connected!");

  try {
    await setupNetworkCapture(conn);

    // Wait for page to be fully loaded
    await new Promise((r) => setTimeout(r, 2000));

    // Perform test operations
    // NOTE: These will actually modify your email!
    // Comment out operations you don't want to run.

    const args = process.argv.slice(2);
    const runAll = args.includes("--all");
    const dryRun = args.includes("--dry-run");

    if (dryRun) {
      console.log("\n=== DRY RUN MODE - Not performing any operations ===\n");
      console.log("Available operations:");
      console.log("  --compose   Test compose and save draft");
      console.log("  --archive   Test archive");
      console.log("  --label     Test add label");
      console.log("  --star      Test star");
      console.log("  --read      Test mark read");
      console.log("  --snooze    Test snooze");
      console.log("  --all       Run all operations");
      console.log("");
      console.log("Example: bun run src/api-investigation/capture-write-apis.ts --compose --star");
    } else {
      if (runAll || args.includes("--compose")) {
        await performComposeAndSave(conn);
      }

      if (runAll || args.includes("--archive")) {
        await performArchive(conn);
      }

      if (runAll || args.includes("--label")) {
        await performLabel(conn);
      }

      if (runAll || args.includes("--star")) {
        await performStar(conn);
      }

      if (runAll || args.includes("--read")) {
        await performMarkRead(conn);
      }

      if (runAll || args.includes("--snooze")) {
        await performSnooze(conn);
      }

      // Give time for final network requests
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Generate and save documentation
    console.log("\n=== Generating Documentation ===");
    const markdown = generateMarkdown();

    const outputPath = "docs/api/write-operations.md";
    await Bun.write(outputPath, markdown);
    console.log(`Documentation saved to ${outputPath}`);

    console.log(`\nCaptured ${completedOperations.length} API operations`);
  } finally {
    await conn.client.close();
  }
}

main().catch(console.error);
