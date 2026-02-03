#!/usr/bin/env bun
/**
 * Full CRUD test for Microsoft Graph calendar
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";
import { listEvents, createEvent, updateEvent, deleteEvent, getFreeBusy } from "../calendar";

async function test() {
  console.log("=== Microsoft Graph Calendar CRUD Test ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Could not connect");
    process.exit(1);
  }

  // 1. Create event
  console.log("1. Creating event...");
  const createResult = await createEvent(conn, {
    summary: "CRUD Test Event " + Date.now(),
    start: {
      dateTime: new Date(Date.now() + 3600000).toISOString(),
      timeZone: "America/New_York"
    },
    end: {
      dateTime: new Date(Date.now() + 7200000).toISOString(),
      timeZone: "America/New_York"
    }
  });
  console.log("Create result:", JSON.stringify(createResult, null, 2));

  if (!createResult.success || !createResult.eventId) {
    console.error("Failed to create event, cannot continue CRUD test");
    await disconnect(conn);
    process.exit(1);
  }

  const eventId = createResult.eventId;
  console.log(`Created event: ${eventId}\n`);

  // 2. List events to verify it exists
  console.log("2. Listing events to verify...");
  const events = await listEvents(conn, {
    timeMin: new Date(),
    timeMax: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
  const found = events.find(e => e.id === eventId);
  console.log(`Found ${events.length} events. Our event found: ${found ? "YES" : "NO"}\n`);

  // 3. Update event
  console.log("3. Updating event...");
  const updateResult = await updateEvent(conn, eventId, {
    summary: "UPDATED CRUD Test Event"
  });
  console.log("Update result:", JSON.stringify(updateResult, null, 2));

  // 4. Check free/busy
  console.log("\n4. Checking free/busy...");
  const freeBusy = await getFreeBusy(conn, {
    timeMin: new Date(),
    timeMax: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
  console.log("Free/busy result:", JSON.stringify(freeBusy, null, 2));

  // 5. Delete event
  console.log("\n5. Deleting event...");
  const deleteResult = await deleteEvent(conn, eventId);
  console.log("Delete result:", JSON.stringify(deleteResult, null, 2));

  // 6. Verify deletion
  console.log("\n6. Verifying deletion...");
  const eventsAfter = await listEvents(conn, {
    timeMin: new Date(),
    timeMax: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
  const stillExists = eventsAfter.find(e => e.id === eventId);
  console.log(`Event still exists: ${stillExists ? "YES (FAIL)" : "NO (PASS)"}`);

  console.log("\n=== CRUD Test Complete ===");
  console.log(`Create: ${createResult.success ? "✅" : "❌"}`);
  console.log(`List: ${found ? "✅" : "❌"}`);
  console.log(`Update: ${updateResult.success ? "✅" : "❌"}`);
  console.log(`Delete: ${deleteResult.success ? "✅" : "❌"}`);
  console.log(`Verify deletion: ${!stillExists ? "✅" : "❌"}`);

  await disconnect(conn);
}

test().catch(console.error);
