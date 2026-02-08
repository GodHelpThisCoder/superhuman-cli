/**
 * Trigger Superhuman Backend Operations
 *
 * This script triggers various Superhuman operations via CDP to capture
 * the backend API endpoints being called.
 *
 * Run capture-superhuman-backend.ts first, then run this script in another terminal.
 */

import { connectToSuperhuman } from "../superhuman-api";
import { snoozeThread, unsnoozeThread, listSnoozed, parseSnoozeTime } from "../snooze";
import { createDraft, sendReply, getThreadInfoForReply } from "../send-api";
import { listInbox } from "../inbox";

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman();

  try {
    // Get inbox first to have a thread ID
    console.log("\n📥 Fetching inbox...");
    const threads = await listInbox(conn, 5);
    console.log(`Found ${threads.length} threads`);

    if (threads.length === 0) {
      console.log("No threads found. Exiting.");
      return;
    }

    const testThread = threads[0];
    console.log(`Using thread: ${testThread.id} - ${testThread.subject}`);

    // Test snooze operations
    console.log("\n⏰ Testing snooze...");
    const snoozeTime = parseSnoozeTime("tomorrow");
    console.log(`Snoozing until: ${snoozeTime.toISOString()}`);
    const snoozeResult = await snoozeThread(conn, testThread.id, snoozeTime);
    console.log(`Snooze result:`, snoozeResult);

    // Wait a bit
    await new Promise(r => setTimeout(r, 2000));

    // Test unsnooze
    if (snoozeResult.success && snoozeResult.reminderId) {
      console.log("\n⏰ Testing unsnooze...");
      const unsnoozeResult = await unsnoozeThread(conn, testThread.id, snoozeResult.reminderId);
      console.log(`Unsnooze result:`, unsnoozeResult);
    }

    // Wait a bit
    await new Promise(r => setTimeout(r, 2000));

    // Test list snoozed
    console.log("\n📋 Listing snoozed threads...");
    const snoozed = await listSnoozed(conn, 5);
    console.log(`Found ${snoozed.length} snoozed threads`);

    // Wait a bit
    await new Promise(r => setTimeout(r, 2000));

    // Test draft creation
    console.log("\n📝 Testing draft creation...");
    const draftResult = await createDraft(conn, {
      to: ["test@example.com"],
      subject: "Test draft for API capture",
      body: "This is a test draft",
      isHtml: false,
    });
    console.log(`Draft result:`, draftResult);

    // Wait a bit
    await new Promise(r => setTimeout(r, 2000));

    // Test get thread info for reply
    console.log("\n📨 Getting thread info for reply...");
    const threadInfo = await getThreadInfoForReply(conn, testThread.id);
    console.log(`Thread info:`, threadInfo);

    console.log("\n✅ Done triggering operations!");
    console.log("Check the capture-superhuman-backend.ts output for captured endpoints.");

  } finally {
    // Don't disconnect - let the capture script continue monitoring
    console.log("\nKeeping connection open for capture...");
  }
}

main().catch(console.error);
