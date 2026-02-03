#!/usr/bin/env bun
/**
 * Calendar Deep Discovery Script
 *
 * Deep exploration of the gcal service and other calendar-related APIs.
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";
import { writeFileSync } from "node:fs";

async function deepDiscovery(): Promise<void> {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333, true);

  if (!conn) {
    console.error("Could not connect to Superhuman");
    process.exit(1);
  }

  const { Runtime, Input } = conn;

  try {
    console.log("\n=== Deep Calendar API Discovery ===\n");

    // Open calendar view
    console.log("Opening calendar view...");
    await Input.dispatchKeyEvent({ type: "keyDown", key: "0", code: "Digit0" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "0", code: "Digit0" });
    await new Promise(r => setTimeout(r, 500));
    await Input.dispatchKeyEvent({ type: "keyDown", key: "0", code: "Digit0" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "0", code: "Digit0" });
    await new Promise(r => setTimeout(r, 3000)); // Wait longer for calendar to fully load

    // Deep exploration of gcal service
    console.log("\n1. Deep exploration of gcal service...");
    const gcalResult = await Runtime.evaluate({
      expression: `
        (() => {
          const gcal = window.GoogleAccount?.di?.get?.('gcal');
          if (!gcal) return { error: "gcal not found" };

          // Get all properties including non-enumerable
          const allProps = [];
          let obj = gcal;
          while (obj && obj !== Object.prototype) {
            allProps.push(...Object.getOwnPropertyNames(obj));
            obj = Object.getPrototypeOf(obj);
          }

          // Categorize properties
          const methods = allProps.filter(p => {
            try { return typeof gcal[p] === 'function'; }
            catch { return false; }
          });

          const properties = allProps.filter(p => {
            try { return typeof gcal[p] !== 'function'; }
            catch { return false; }
          });

          // Get property values for non-functions
          const propValues = {};
          for (const p of properties.slice(0, 20)) {
            try {
              const val = gcal[p];
              propValues[p] = typeof val === 'object' ? Object.keys(val || {}).slice(0, 10) : String(val).slice(0, 100);
            } catch {}
          }

          return {
            type: typeof gcal,
            constructor: gcal.constructor?.name,
            methods: [...new Set(methods)],
            properties: [...new Set(properties)],
            propValues
          };
        })()
      `,
      returnByValue: true,
    });

    console.log("gcal service:", JSON.stringify(gcalResult.result.value, null, 2));

    // Check if there's a Google Calendar API client
    console.log("\n2. Looking for Google Calendar API client...");
    const gApiResult = await Runtime.evaluate({
      expression: `
        (() => {
          // Check for gapi (Google API client)
          if (window.gapi?.client?.calendar) {
            return {
              found: "gapi.client.calendar",
              methods: Object.keys(window.gapi.client.calendar)
            };
          }

          // Check for googleapis
          if (window.googleapis) {
            return {
              found: "googleapis",
              keys: Object.keys(window.googleapis)
            };
          }

          // Check DI for 'google' service
          const google = window.GoogleAccount?.di?.get?.('google');
          if (google) {
            const methods = Object.keys(google).filter(k => typeof google[k] === 'function');
            return { found: "di.google", methods };
          }

          return { found: null };
        })()
      `,
      returnByValue: true,
    });

    console.log("Google API client:", JSON.stringify(gApiResult.result.value, null, 2));

    // Look for calendar state in ViewState
    console.log("\n3. Exploring ViewState deeply...");
    const viewStateResult = await Runtime.evaluate({
      expression: `
        (() => {
          const vs = window.ViewState;
          if (!vs) return { error: "ViewState not found" };

          const allKeys = Object.keys(vs);

          // Find anything calendar, event, or schedule related
          const relevant = allKeys.filter(k => {
            const lower = k.toLowerCase();
            return lower.includes('calendar') ||
                   lower.includes('event') ||
                   lower.includes('schedule') ||
                   lower.includes('meeting') ||
                   lower.includes('agenda');
          });

          // Also check tree structure
          const tree = vs.tree?.get?.() || vs.tree?._data;
          const treeKeys = tree ? Object.keys(tree) : [];
          const calendarTreeKeys = treeKeys.filter(k => {
            const lower = k.toLowerCase();
            return lower.includes('calendar') ||
                   lower.includes('event') ||
                   lower.includes('schedule');
          });

          // Check for calendarPane or similar
          const paneKeys = treeKeys.filter(k => k.includes('Pane') || k.includes('pane'));

          return {
            relevantKeys: relevant,
            treeKeys: treeKeys.slice(0, 30),
            calendarTreeKeys,
            paneKeys
          };
        })()
      `,
      returnByValue: true,
    });

    console.log("ViewState exploration:", JSON.stringify(viewStateResult.result.value, null, 2));

    // Try to find event data in the current view
    console.log("\n4. Looking for event data in current view...");
    const eventDataResult = await Runtime.evaluate({
      expression: `
        (() => {
          const ga = window.GoogleAccount;

          // Look for events identity map like threads
          const eventsMap = ga?.events?.identityMap || ga?.calendarEvents?.identityMap;
          if (eventsMap) {
            const entries = [...eventsMap.entries()].slice(0, 5);
            return { found: "events identityMap", count: eventsMap.size, sample: entries };
          }

          // Check for calendar controller
          const ctrl = window.ViewState?.calendarController ||
                       window.ViewState?.eventController ||
                       window.ViewState?._calendarController;
          if (ctrl) {
            return {
              found: "controller",
              methods: Object.keys(ctrl).filter(k => typeof ctrl[k] === 'function'),
              props: Object.keys(ctrl).filter(k => typeof ctrl[k] !== 'function')
            };
          }

          // Check tree for calendar data
          const tree = window.ViewState?.tree;
          const treeData = tree?.get?.() || tree?._data;
          if (treeData?.calendarPane || treeData?.calendar) {
            return {
              found: "tree.calendar",
              data: treeData.calendarPane || treeData.calendar
            };
          }

          return { found: null };
        })()
      `,
      returnByValue: true,
    });

    console.log("Event data:", JSON.stringify(eventDataResult.result.value, null, 2));

    // Check all DI services for calendar-related functionality
    console.log("\n5. Enumerating ALL DI services...");
    const allDiResult = await Runtime.evaluate({
      expression: `
        (() => {
          const di = window.GoogleAccount?.di;
          if (!di) return { error: "DI not found" };

          // Try to find how to enumerate all services
          // Common pattern is to look at di._container or di._services
          const container = di._container || di.container || di._services || di.services;
          if (container) {
            if (container instanceof Map) {
              return { services: [...container.keys()] };
            }
            if (typeof container === 'object') {
              return { services: Object.keys(container) };
            }
          }

          // Try known service names
          const knownServices = [
            'gmail', 'msgraph', 'gcal', 'calendar', 'google', 'outlook',
            'threads', 'messages', 'labels', 'backend', 'portal',
            'events', 'meetings', 'reminders', 'notifications',
            'isMicrosoft', 'account', 'user', 'settings'
          ];

          const foundServices = [];
          for (const name of knownServices) {
            try {
              const svc = di.get?.(name);
              if (svc !== undefined && svc !== null) {
                foundServices.push({
                  name,
                  type: typeof svc,
                  isObject: typeof svc === 'object',
                  methodCount: typeof svc === 'object' ?
                    Object.keys(svc).filter(k => typeof svc[k] === 'function').length : 0
                });
              }
            } catch {}
          }

          return { foundServices };
        })()
      `,
      returnByValue: true,
    });

    console.log("All DI services:", JSON.stringify(allDiResult.result.value, null, 2));

    // Try portal.invoke for calendar services
    console.log("\n6. Testing portal.invoke for calendar services...");
    const portalResult = await Runtime.evaluate({
      expression: `
        (async () => {
          const portal = window.GoogleAccount?.portal;
          if (!portal?.invoke) return { error: "portal.invoke not found" };

          const results = {};

          // Try different service/method combinations
          const attempts = [
            ['calendarInternal', 'listAsync', []],
            ['calendarInternal', 'list', []],
            ['calendar', 'listAsync', []],
            ['calendar', 'list', []],
            ['calendar', 'getEvents', []],
            ['eventInternal', 'listAsync', []],
            ['events', 'list', []],
            ['gcal', 'list', []],
            ['gcal', 'getEvents', []]
          ];

          for (const [service, method, args] of attempts) {
            try {
              const result = await portal.invoke(service, method, args);
              results[service + '.' + method] = {
                success: true,
                hasData: !!result,
                type: typeof result,
                keys: typeof result === 'object' ? Object.keys(result || {}) : null
              };
            } catch (e) {
              results[service + '.' + method] = { error: e.message };
            }
          }

          return results;
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    console.log("Portal invoke results:", JSON.stringify(portalResult.result.value, null, 2));

    // Look for any calendar-related DOM elements or React components
    console.log("\n7. Looking for calendar DOM/React components...");
    const domResult = await Runtime.evaluate({
      expression: `
        (() => {
          // Find calendar-related elements
          const calendarElements = document.querySelectorAll('[class*="calendar" i], [class*="event" i], [class*="schedule" i]');
          const classes = [...new Set([...calendarElements].map(el => el.className).filter(c => c))].slice(0, 20);

          // Try to find React fiber with calendar state
          const root = document.querySelector('#root');
          const fiber = root?._reactRootContainer?._internalRoot?.current;

          let calendarFiberInfo = null;
          function findCalendarFiber(fiber, depth = 0) {
            if (!fiber || depth > 10) return null;
            const name = fiber.type?.displayName || fiber.type?.name || '';
            if (name.toLowerCase().includes('calendar') || name.toLowerCase().includes('event')) {
              return { name, hasState: !!fiber.memoizedState, depth };
            }
            const child = findCalendarFiber(fiber.child, depth + 1);
            if (child) return child;
            return findCalendarFiber(fiber.sibling, depth);
          }

          if (fiber) {
            calendarFiberInfo = findCalendarFiber(fiber);
          }

          return {
            elementCount: calendarElements.length,
            classes,
            calendarFiberInfo
          };
        })()
      `,
      returnByValue: true,
    });

    console.log("DOM/React exploration:", JSON.stringify(domResult.result.value, null, 2));

    // Write all results
    const output = {
      timestamp: new Date().toISOString(),
      gcal: gcalResult.result.value,
      gApi: gApiResult.result.value,
      viewState: viewStateResult.result.value,
      eventData: eventDataResult.result.value,
      allDi: allDiResult.result.value,
      portal: portalResult.result.value,
      dom: domResult.result.value
    };

    writeFileSync("docs/api/calendar-deep-discovery.json", JSON.stringify(output, null, 2));
    console.log("\n\nResults written to docs/api/calendar-deep-discovery.json");

  } finally {
    await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });
    await disconnect(conn);
  }
}

deepDiscovery().catch(console.error);
