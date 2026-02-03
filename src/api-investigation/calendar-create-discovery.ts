#!/usr/bin/env bun
/**
 * Calendar Create Discovery Script
 *
 * Explores how Superhuman creates calendar events internally.
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function discoverCalendarCreate(): Promise<void> {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333, true);

  if (!conn) {
    console.error("Could not connect to Superhuman");
    process.exit(1);
  }

  const { Runtime, Input } = conn;

  try {
    console.log("\n=== Calendar Create Discovery ===\n");

    // Open calendar view
    console.log("Opening calendar view...");
    await Input.dispatchKeyEvent({ type: "keyDown", key: "0", code: "Digit0" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "0", code: "Digit0" });
    await new Promise(r => setTimeout(r, 500));
    await Input.dispatchKeyEvent({ type: "keyDown", key: "0", code: "Digit0" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "0", code: "Digit0" });
    await new Promise(r => setTimeout(r, 3000));

    // Check for event creation methods
    console.log("\n1. Looking for event creation methods in gcal...");
    const gcalMethodsResult = await Runtime.evaluate({
      expression: `
        (() => {
          const gcal = window.GoogleAccount?.di?.get?.('gcal');
          if (!gcal) return { error: "gcal not found" };

          const allProps = [];
          let obj = gcal;
          while (obj && obj !== Object.prototype) {
            allProps.push(...Object.getOwnPropertyNames(obj));
            obj = Object.getPrototypeOf(obj);
          }

          const methods = [...new Set(allProps.filter(p => {
            try { return typeof gcal[p] === 'function'; }
            catch { return false; }
          }))];

          // Find create/import related methods
          const createMethods = methods.filter(m => {
            const lower = m.toLowerCase();
            return lower.includes('create') ||
                   lower.includes('import') ||
                   lower.includes('add') ||
                   lower.includes('insert') ||
                   lower.includes('new') ||
                   lower.includes('post');
          });

          return { createMethods, allMethods: methods };
        })()
      `,
      returnByValue: true,
    });

    console.log("gcal create methods:", JSON.stringify(gcalMethodsResult.result.value, null, 2));

    // Check backend for event creation
    console.log("\n2. Looking for event creation in backend...");
    const backendResult = await Runtime.evaluate({
      expression: `
        (() => {
          const backend = window.GoogleAccount?.backend;
          if (!backend) return { error: "backend not found" };

          const methods = Object.keys(backend).filter(k => typeof backend[k] === 'function');
          const createMethods = methods.filter(m => {
            const lower = m.toLowerCase();
            return lower.includes('event') ||
                   lower.includes('calendar') ||
                   lower.includes('meeting') ||
                   lower.includes('create');
          });

          return { createMethods, allMethods: methods };
        })()
      `,
      returnByValue: true,
    });

    console.log("backend methods:", JSON.stringify(backendResult.result.value, null, 2));

    // Check ViewState for event creation functions
    console.log("\n3. Looking for event creation in ViewState...");
    const viewStateResult = await Runtime.evaluate({
      expression: `
        (() => {
          const vs = window.ViewState;
          if (!vs) return { error: "ViewState not found" };

          // Check tree for calendar controller or event creation state
          const tree = vs.tree?.get?.() || vs.tree?._data;

          return {
            isCreatingEvent: tree?.isCreatingEvent,
            isCreatingEventWithAI: tree?.isCreatingEventWithAI,
            calendarMode: tree?.calendarMode,
            calendarKeys: Object.keys(tree?.calendar || {}),
            // Look for event creation controller
            hasEventController: !!vs.eventController,
            hasCalendarController: !!vs.calendarController
          };
        })()
      `,
      returnByValue: true,
    });

    console.log("ViewState calendar state:", JSON.stringify(viewStateResult.result.value, null, 2));

    // Try to find the actual event creation flow
    console.log("\n4. Trying importEvent with more detail...");
    const importResult = await Runtime.evaluate({
      expression: `
        (async () => {
          const gcal = window.GoogleAccount?.di?.get?.('gcal');
          if (!gcal) return { error: "gcal not found" };

          // Check the importEvent function signature
          const importEventStr = gcal.importEvent?.toString?.();

          // Try calling it with minimal data
          const accountEmail = window.GoogleAccount?.account?.emailAddress || 'primary';

          const testEvent = {
            summary: "Test",
            start: { dateTime: new Date(Date.now() + 3600000).toISOString() },
            end: { dateTime: new Date(Date.now() + 7200000).toISOString() }
          };

          try {
            const result = await gcal.importEvent(accountEmail, testEvent);
            return { success: true, result, functionSignature: importEventStr?.slice(0, 200) };
          } catch (e) {
            return { error: e.message, stack: e.stack?.slice(0, 500), functionSignature: importEventStr?.slice(0, 200) };
          }
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    console.log("importEvent test:", JSON.stringify(importResult.result.value, null, 2));

    // Check for Google Calendar API direct endpoint
    console.log("\n5. Checking for direct Google Calendar API access...");
    const directApiResult = await Runtime.evaluate({
      expression: `
        (() => {
          const gcal = window.GoogleAccount?.di?.get?.('gcal');
          if (!gcal) return { error: "gcal not found" };

          // Check _postAsync and _fetch methods
          return {
            hasPostAsync: typeof gcal._postAsync === 'function',
            hasFetch: typeof gcal._fetch === 'function',
            hasBackend: !!gcal._backend,
            backendType: gcal._backend?.constructor?.name
          };
        })()
      `,
      returnByValue: true,
    });

    console.log("Direct API access:", JSON.stringify(directApiResult.result.value, null, 2));

    // Check what happens when user creates event via UI
    console.log("\n6. Checking regional commands for event creation...");
    const commandsResult = await Runtime.evaluate({
      expression: `
        (() => {
          const rc = window.ViewState?.regionalCommands || [];
          const calendarCommands = [];

          for (const region of rc) {
            if (region?.commands) {
              for (const cmd of region.commands) {
                if (cmd.id?.toLowerCase().includes('event') ||
                    cmd.id?.toLowerCase().includes('calendar') ||
                    cmd.id?.toLowerCase().includes('meeting') ||
                    cmd.id?.toLowerCase().includes('create')) {
                  calendarCommands.push({
                    id: cmd.id,
                    hasAction: typeof cmd.action === 'function'
                  });
                }
              }
            }
          }

          return { calendarCommands };
        })()
      `,
      returnByValue: true,
    });

    console.log("Calendar commands:", JSON.stringify(commandsResult.result.value, null, 2));

  } finally {
    await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });
    await disconnect(conn);
  }
}

discoverCalendarCreate().catch(console.error);
