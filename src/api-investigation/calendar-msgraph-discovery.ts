#!/usr/bin/env bun
/**
 * Microsoft Graph Calendar API Discovery Script
 *
 * Explores Superhuman's msgraph service for calendar-related methods.
 * Run this with a Microsoft/Outlook account active.
 *
 * Usage: bun run src/api-investigation/calendar-msgraph-discovery.ts
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";
import { writeFileSync } from "node:fs";

async function discoverMsgraphCalendar(): Promise<void> {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333, true);

  if (!conn) {
    console.error("Could not connect to Superhuman");
    process.exit(1);
  }

  const { Runtime, Input } = conn;

  try {
    console.log("\n=== Microsoft Graph Calendar Discovery ===\n");

    // Check if this is a Microsoft account
    const accountCheck = await Runtime.evaluate({
      expression: `
        (() => {
          const di = window.GoogleAccount?.di;
          return {
            isMicrosoft: di?.get?.('isMicrosoft'),
            email: window.GoogleAccount?.account?.emailAddress
          };
        })()
      `,
      returnByValue: true,
    });

    const accountInfo = accountCheck.result.value as { isMicrosoft: boolean; email: string };
    console.log(`Account: ${accountInfo.email}`);
    console.log(`Is Microsoft: ${accountInfo.isMicrosoft}`);

    if (!accountInfo.isMicrosoft) {
      console.log("\nThis is a Google account. Switch to a Microsoft account for msgraph discovery.");
      console.log("Showing available msgraph methods anyway...\n");
    }

    // Open calendar view
    console.log("Opening calendar view...");
    await Input.dispatchKeyEvent({ type: "keyDown", key: "0", code: "Digit0" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "0", code: "Digit0" });
    await new Promise(r => setTimeout(r, 500));
    await Input.dispatchKeyEvent({ type: "keyDown", key: "0", code: "Digit0" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "0", code: "Digit0" });
    await new Promise(r => setTimeout(r, 3000));

    // Deep exploration of msgraph service
    console.log("\n1. Deep exploration of msgraph service...");
    const msgraphResult = await Runtime.evaluate({
      expression: `
        (() => {
          const msgraph = window.GoogleAccount?.di?.get?.('msgraph');
          if (!msgraph) return { error: "msgraph service not found" };

          // Get all properties including prototype chain
          const allProps = [];
          let obj = msgraph;
          while (obj && obj !== Object.prototype) {
            allProps.push(...Object.getOwnPropertyNames(obj));
            obj = Object.getPrototypeOf(obj);
          }

          // Categorize
          const methods = [...new Set(allProps.filter(p => {
            try { return typeof msgraph[p] === 'function'; }
            catch { return false; }
          }))];

          // Find calendar-related methods
          const calendarMethods = methods.filter(m => {
            const lower = m.toLowerCase();
            return lower.includes('calendar') ||
                   lower.includes('event') ||
                   lower.includes('meeting') ||
                   lower.includes('schedule') ||
                   lower.includes('free') ||
                   lower.includes('busy') ||
                   lower.includes('rsvp');
          });

          // Get all methods for reference
          const allMethods = methods.filter(m => !m.startsWith('_'));

          return {
            type: typeof msgraph,
            constructor: msgraph.constructor?.name,
            calendarMethods,
            allMethods,
            totalMethods: methods.length
          };
        })()
      `,
      returnByValue: true,
    });

    console.log("msgraph service:", JSON.stringify(msgraphResult.result.value, null, 2));

    // Check for Outlook calendar specific service
    console.log("\n2. Looking for Outlook calendar service...");
    const outlookResult = await Runtime.evaluate({
      expression: `
        (() => {
          const di = window.GoogleAccount?.di;

          // Try common service names
          const serviceNames = [
            'outlook', 'outlookCalendar', 'microsoftCalendar',
            'calendar', 'ocal', 'o365Calendar'
          ];

          const found = [];
          for (const name of serviceNames) {
            try {
              const svc = di?.get?.(name);
              if (svc) {
                const methods = Object.keys(svc).filter(k => typeof svc[k] === 'function');
                found.push({ name, methods });
              }
            } catch {}
          }

          return { found };
        })()
      `,
      returnByValue: true,
    });

    console.log("Outlook services:", JSON.stringify(outlookResult.result.value, null, 2));

    // Try to list calendar events via msgraph
    console.log("\n3. Attempting to list calendar events via msgraph...");
    const eventsResult = await Runtime.evaluate({
      expression: `
        (async () => {
          const msgraph = window.GoogleAccount?.di?.get?.('msgraph');
          if (!msgraph) return { error: "msgraph not found" };

          // Try various method names
          const attempts = [];

          // Try getEvents
          if (typeof msgraph.getEvents === 'function') {
            try {
              const events = await msgraph.getEvents();
              attempts.push({ method: 'getEvents', success: true, count: events?.length });
            } catch (e) {
              attempts.push({ method: 'getEvents', error: e.message });
            }
          }

          // Try getCalendarEvents
          if (typeof msgraph.getCalendarEvents === 'function') {
            try {
              const events = await msgraph.getCalendarEvents();
              attempts.push({ method: 'getCalendarEvents', success: true, count: events?.length });
            } catch (e) {
              attempts.push({ method: 'getCalendarEvents', error: e.message });
            }
          }

          // Try listEvents
          if (typeof msgraph.listEvents === 'function') {
            try {
              const events = await msgraph.listEvents();
              attempts.push({ method: 'listEvents', success: true, count: events?.length });
            } catch (e) {
              attempts.push({ method: 'listEvents', error: e.message });
            }
          }

          // Try getCalendarView
          if (typeof msgraph.getCalendarView === 'function') {
            try {
              const now = new Date();
              const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
              const events = await msgraph.getCalendarView(now.toISOString(), weekLater.toISOString());
              attempts.push({ method: 'getCalendarView', success: true, count: events?.length });
            } catch (e) {
              attempts.push({ method: 'getCalendarView', error: e.message });
            }
          }

          return { attempts };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    console.log("Event listing attempts:", JSON.stringify(eventsResult.result.value, null, 2));

    // Check ViewState for Microsoft calendar data
    console.log("\n4. Checking ViewState for Microsoft calendar data...");
    const viewStateResult = await Runtime.evaluate({
      expression: `
        (() => {
          const tree = window.ViewState?.tree?.get?.() || window.ViewState?.tree?._data;
          if (!tree) return { error: "tree not found" };

          // Get calendar data
          const calendarData = tree.calendar;
          if (!calendarData) return { calendarData: null };

          // Get structure without full event data
          return {
            hasCache: !!calendarData.cache,
            cacheKeys: calendarData.cache ? Object.keys(calendarData.cache) : [],
            otherKeys: Object.keys(calendarData).filter(k => k !== 'cache'),
            sampleEventKeys: calendarData.cache ?
              Object.keys(calendarData.cache[Object.keys(calendarData.cache)[0]]?.[0] || {}) : []
          };
        })()
      `,
      returnByValue: true,
    });

    console.log("ViewState calendar:", JSON.stringify(viewStateResult.result.value, null, 2));

    // Try to find Microsoft Graph calendar methods by looking at API patterns
    console.log("\n5. Exploring msgraph API patterns...");
    const apiResult = await Runtime.evaluate({
      expression: `
        (() => {
          const msgraph = window.GoogleAccount?.di?.get?.('msgraph');
          if (!msgraph) return { error: "msgraph not found" };

          // Check for _getAsync, _postAsync etc patterns like gcal
          const hasAsyncMethods = {
            _getAsync: typeof msgraph._getAsync === 'function',
            _postAsync: typeof msgraph._postAsync === 'function',
            _patchAsync: typeof msgraph._patchAsync === 'function',
            _deleteAsync: typeof msgraph._deleteAsync === 'function',
            _fetch: typeof msgraph._fetch === 'function'
          };

          // Check backend
          const backend = msgraph._backend;
          const backendMethods = backend ? Object.keys(backend).filter(k => typeof backend[k] === 'function') : [];

          return {
            hasAsyncMethods,
            hasBackend: !!backend,
            backendMethods
          };
        })()
      `,
      returnByValue: true,
    });

    console.log("API patterns:", JSON.stringify(apiResult.result.value, null, 2));

    // Compile results
    const output = {
      timestamp: new Date().toISOString(),
      account: accountInfo,
      msgraph: msgraphResult.result.value,
      outlookServices: outlookResult.result.value,
      eventAttempts: eventsResult.result.value,
      viewState: viewStateResult.result.value,
      apiPatterns: apiResult.result.value
    };

    writeFileSync("docs/api/calendar-msgraph-discovery.json", JSON.stringify(output, null, 2));
    console.log("\n\nResults written to docs/api/calendar-msgraph-discovery.json");

  } finally {
    await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });
    await disconnect(conn);
  }
}

discoverMsgraphCalendar().catch(console.error);
