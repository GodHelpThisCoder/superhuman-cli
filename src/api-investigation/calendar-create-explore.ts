#!/usr/bin/env bun
/**
 * Explore how to create calendar events in Superhuman
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function explore() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Could not connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  console.log("=== Exploring Calendar Event Creation ===\n");

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        const findings = {};
        const vs = window.ViewState;
        const ga = window.GoogleAccount;
        const gcal = ga?.di?.get?.("gcal");

        // All gcal methods
        if (gcal) {
          const allMethods = [];
          let obj = gcal;
          while (obj && obj !== Object.prototype) {
            allMethods.push(...Object.getOwnPropertyNames(obj).filter(p => {
              try { return typeof gcal[p] === "function"; }
              catch { return false; }
            }));
            obj = Object.getPrototypeOf(obj);
          }
          findings.gcalMethods = [...new Set(allMethods)].sort();
        }

        // Regional commands
        const rc = vs?.regionalCommands || [];
        const calendarCommands = [];
        for (const region of rc) {
          if (region?.commands) {
            for (const cmd of region.commands) {
              const id = cmd.id || "";
              if (id.toLowerCase().includes("event") ||
                  id.toLowerCase().includes("calendar") ||
                  id.toLowerCase().includes("meeting") ||
                  id.toLowerCase().includes("schedule") ||
                  id.toLowerCase().includes("create")) {
                calendarCommands.push(cmd.id);
              }
            }
          }
        }
        findings.calendarCommands = calendarCommands;

        // ViewState.actions
        if (vs?.actions) {
          findings.vsActions = Object.keys(vs.actions).filter(k =>
            k.toLowerCase().includes("event") ||
            k.toLowerCase().includes("calendar") ||
            k.toLowerCase().includes("schedule")
          );
        }

        // Check for insertEvent specifically
        if (gcal) {
          findings.insertEventExists = typeof gcal.insertEvent === "function";
          findings.importEventExists = typeof gcal.importEvent === "function";

          // Get the function signature/source
          if (gcal.insertEvent) {
            findings.insertEventSrc = gcal.insertEvent.toString().slice(0, 300);
          }
          if (gcal.importEvent) {
            findings.importEventSrc = gcal.importEvent.toString().slice(0, 300);
          }
        }

        return findings;
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));

  // Try to find the correct method by testing insertEvent
  console.log("\n=== Testing insertEvent ===\n");

  const insertTest = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const gcal = ga?.di?.get?.("gcal");
        const accountEmail = ga?.account?.emailAddress || "primary";

        if (!gcal?.insertEvent) {
          return { error: "insertEvent not found" };
        }

        const testEvent = {
          summary: "Test Event from API",
          start: { dateTime: new Date(Date.now() + 3600000).toISOString() },
          end: { dateTime: new Date(Date.now() + 7200000).toISOString() }
        };

        try {
          // Try different call patterns
          const result = await gcal.insertEvent(accountEmail, testEvent);
          return { success: true, result };
        } catch (e) {
          return { error: e.message, stack: e.stack?.slice(0, 500) };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("insertEvent test:", JSON.stringify(insertTest.result.value, null, 2));

  // Explore CREATE_EVENT command
  console.log("\n=== Exploring CREATE_EVENT Command ===\n");

  const cmdResult = await Runtime.evaluate({
    expression: `
      (() => {
        const vs = window.ViewState;
        const rc = vs?.regionalCommands || [];

        for (const region of rc) {
          if (region?.commands) {
            for (const cmd of region.commands) {
              if (cmd.id === "CREATE_EVENT") {
                return {
                  id: cmd.id,
                  actionSrc: cmd.action?.toString?.()?.slice(0, 500),
                  keys: Object.keys(cmd)
                };
              }
            }
          }
        }
        return { error: "CREATE_EVENT not found" };
      })()
    `,
    returnByValue: true,
  });

  console.log("CREATE_EVENT command:", JSON.stringify(cmdResult.result.value, null, 2));

  // Try using _postAsync directly to create event
  console.log("\n=== Testing direct POST to /events ===\n");

  const directPost = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const gcal = ga?.di?.get?.("gcal");
        const accountEmail = ga?.account?.emailAddress || "primary";

        if (!gcal?._postAsync) {
          return { error: "_postAsync not found" };
        }

        const testEvent = {
          summary: "Test Event Created via API",
          start: { dateTime: new Date(Date.now() + 3600000).toISOString(), timeZone: "America/New_York" },
          end: { dateTime: new Date(Date.now() + 7200000).toISOString(), timeZone: "America/New_York" }
        };

        try {
          // Use the correct Google Calendar API endpoint for creating events
          const url = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(accountEmail) + "/events";
          const result = await gcal._postAsync(url, testEvent, {
            endpoint: "gcal.events.insert",
            calendarAccountEmail: accountEmail
          });
          return { success: true, result };
        } catch (e) {
          return { error: e.message, stack: e.stack?.slice(0, 500) };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("Direct POST test:", JSON.stringify(directPost.result.value, null, 2));

  // Explore _calendarCreateEvent
  console.log("\n=== Exploring _calendarCreateEvent ===\n");

  const calCreateResult = await Runtime.evaluate({
    expression: `
      (() => {
        const vs = window.ViewState;

        // Find _calendarCreateEvent method
        if (typeof vs?._calendarCreateEvent === "function") {
          return {
            found: true,
            src: vs._calendarCreateEvent.toString().slice(0, 1000)
          };
        }

        // Search in ViewState prototype chain
        let obj = vs;
        while (obj) {
          if (obj._calendarCreateEvent) {
            return {
              found: true,
              src: obj._calendarCreateEvent.toString().slice(0, 1000)
            };
          }
          obj = Object.getPrototypeOf(obj);
        }

        // Check if it opens a dialog/modal
        return { found: false, vsKeys: Object.keys(vs || {}).filter(k => k.includes("calendar") || k.includes("Calendar") || k.includes("event") || k.includes("Event")).slice(0, 20) };
      })()
    `,
    returnByValue: true,
  });

  console.log("_calendarCreateEvent:", JSON.stringify(calCreateResult.result.value, null, 2));

  // Check what happens when we trigger the command via keyboard
  console.log("\n=== Checking calendar creation flow ===\n");

  const flowResult = await Runtime.evaluate({
    expression: `
      (() => {
        const vs = window.ViewState;
        const tree = vs?.tree?.get?.() || vs?.tree?._data;

        return {
          isCreatingEvent: tree?.isCreatingEvent,
          isCreatingEventWithAI: tree?.isCreatingEventWithAI,
          calendarMode: tree?.calendarMode,
          hasEventDialog: !!tree?.eventDialog,
          hasNewEventData: !!tree?.newEventData,
          calendarKeys: Object.keys(tree?.calendar || {}).slice(0, 10),
          treeKeys: Object.keys(tree || {}).filter(k =>
            k.toLowerCase().includes("event") ||
            k.toLowerCase().includes("create")
          )
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("Calendar state:", JSON.stringify(flowResult.result.value, null, 2));

  // Let's open calendar view and try to trigger event creation via keyboard
  console.log("\n=== Opening Calendar and Triggering Create Event ===\n");

  const { Input } = conn;

  // Press 0 twice to open calendar
  await Input.dispatchKeyEvent({ type: "keyDown", key: "0", code: "Digit0" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "0", code: "Digit0" });
  await new Promise(r => setTimeout(r, 300));
  await Input.dispatchKeyEvent({ type: "keyDown", key: "0", code: "Digit0" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "0", code: "Digit0" });
  await new Promise(r => setTimeout(r, 2000));

  // Check calendar state after opening
  const afterOpen = await Runtime.evaluate({
    expression: `
      (() => {
        const tree = window.ViewState?.tree?.get?.() || window.ViewState?.tree?._data;
        return {
          calendarMode: tree?.calendarMode,
          isInCalendar: tree?.currentView === "calendar" || tree?.calendarMode !== "DEFAULT"
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("After opening calendar:", JSON.stringify(afterOpen.result.value, null, 2));

  // Try pressing 'c' which often triggers create in Superhuman
  console.log("Pressing 'c' to create event...");
  await Input.dispatchKeyEvent({ type: "keyDown", key: "c", code: "KeyC" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "c", code: "KeyC" });
  await new Promise(r => setTimeout(r, 1000));

  // Check state after pressing 'c'
  const afterCreate = await Runtime.evaluate({
    expression: `
      (() => {
        const tree = window.ViewState?.tree?.get?.() || window.ViewState?.tree?._data;
        return {
          isCreatingEvent: tree?.isCreatingEvent,
          isCreatingEventWithAI: tree?.isCreatingEventWithAI,
          calendarMode: tree?.calendarMode,
          eventFormOpen: !!tree?.eventForm || !!tree?.createEventForm,
          treeEventKeys: Object.keys(tree || {}).filter(k =>
            k.toLowerCase().includes("event") ||
            k.toLowerCase().includes("form") ||
            k.toLowerCase().includes("create") ||
            k.toLowerCase().includes("dialog")
          )
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("After pressing 'c':", JSON.stringify(afterCreate.result.value, null, 2));

  // Press Escape to close any dialog
  await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });

  await disconnect(conn);
}

explore().catch(console.error);
