#!/usr/bin/env bun
/**
 * Calendar API Discovery Script
 *
 * Explores Superhuman's internal APIs to discover calendar-related services and methods.
 * Run this via CDP to enumerate available calendar functionality.
 *
 * Usage: bun run src/api-investigation/calendar-discovery.ts
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";
import { writeFileSync } from "node:fs";

interface DiscoveryResult {
  timestamp: string;
  accountType: "google" | "microsoft" | "unknown";
  diServices: Array<{ name: string; methods: string[] }>;
  gmailCalendarMethods: string[];
  msgraphCalendarMethods: string[];
  backendCalendarMethods: string[];
  portalServices: string[];
  calendarViewState: Record<string, unknown> | null;
  errors: string[];
}

async function discoverCalendarApis(): Promise<void> {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333, true);

  if (!conn) {
    console.error("Could not connect to Superhuman");
    process.exit(1);
  }

  const { Runtime, Input } = conn;
  const errors: string[] = [];

  try {
    console.log("\n=== Calendar API Discovery ===\n");

    // Step 1: Open calendar view by pressing 0 twice
    console.log("Opening calendar view (pressing 0 twice)...");
    await Input.dispatchKeyEvent({ type: "keyDown", key: "0", code: "Digit0" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "0", code: "Digit0" });
    await new Promise(r => setTimeout(r, 500));
    await Input.dispatchKeyEvent({ type: "keyDown", key: "0", code: "Digit0" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "0", code: "Digit0" });
    await new Promise(r => setTimeout(r, 2000)); // Wait for calendar to load

    // Step 2: Enumerate DI services
    console.log("\nEnumerating DI services...");
    const diResult = await Runtime.evaluate({
      expression: `
        (async () => {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) {
            return { error: "DI container not found" };
          }

          // Check account type
          const isMicrosoft = di.get?.('isMicrosoft');

          // Try common calendar service names
          const serviceNames = [
            'calendar', 'googleCalendar', 'outlookCalendar',
            'events', 'meetings', 'calendarEvents',
            'gcal', 'outlook', 'calendarService',
            'eventService', 'meetingService'
          ];

          const foundServices = [];
          for (const name of serviceNames) {
            try {
              const svc = di.get?.(name);
              if (svc) {
                const methods = Object.keys(svc).filter(k => typeof svc[k] === 'function');
                foundServices.push({ name, methods });
              }
            } catch (e) {
              // Service not found
            }
          }

          return {
            isMicrosoft,
            foundServices
          };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    const diData = diResult.result.value as {
      isMicrosoft?: boolean;
      foundServices?: Array<{ name: string; methods: string[] }>;
      error?: string;
    };

    if (diData.error) {
      errors.push(`DI: ${diData.error}`);
    }

    console.log(`Account type: ${diData.isMicrosoft ? "Microsoft" : "Google"}`);
    console.log(`Found ${diData.foundServices?.length || 0} calendar-related DI services`);

    // Step 3: Check gmail service for calendar methods
    console.log("\nChecking gmail service for calendar methods...");
    const gmailResult = await Runtime.evaluate({
      expression: `
        (() => {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { methods: [], error: "gmail service not found" };

          const allMethods = Object.keys(gmail).filter(k => typeof gmail[k] === 'function');
          const calendarMethods = allMethods.filter(k =>
            k.toLowerCase().includes('calendar') ||
            k.toLowerCase().includes('event') ||
            k.toLowerCase().includes('meeting') ||
            k.toLowerCase().includes('schedule') ||
            k.toLowerCase().includes('rsvp') ||
            k.toLowerCase().includes('busy') ||
            k.toLowerCase().includes('free')
          );

          return { methods: calendarMethods, allMethodCount: allMethods.length };
        })()
      `,
      returnByValue: true,
    });

    const gmailData = gmailResult.result.value as {
      methods: string[];
      allMethodCount?: number;
      error?: string;
    };

    if (gmailData.error) {
      errors.push(`Gmail: ${gmailData.error}`);
    }

    console.log(`Gmail service has ${gmailData.allMethodCount || 0} total methods`);
    console.log(`Calendar-related methods: ${gmailData.methods?.join(", ") || "none"}`);

    // Step 4: Check msgraph service for calendar methods
    console.log("\nChecking msgraph service for calendar methods...");
    const msgraphResult = await Runtime.evaluate({
      expression: `
        (() => {
          const msgraph = window.GoogleAccount?.di?.get?.('msgraph');
          if (!msgraph) return { methods: [], error: "msgraph service not found" };

          const allMethods = Object.keys(msgraph).filter(k => typeof msgraph[k] === 'function');
          const calendarMethods = allMethods.filter(k =>
            k.toLowerCase().includes('calendar') ||
            k.toLowerCase().includes('event') ||
            k.toLowerCase().includes('meeting') ||
            k.toLowerCase().includes('schedule') ||
            k.toLowerCase().includes('rsvp') ||
            k.toLowerCase().includes('busy') ||
            k.toLowerCase().includes('free')
          );

          return { methods: calendarMethods, allMethodCount: allMethods.length };
        })()
      `,
      returnByValue: true,
    });

    const msgraphData = msgraphResult.result.value as {
      methods: string[];
      allMethodCount?: number;
      error?: string;
    };

    if (msgraphData.error && !diData.isMicrosoft) {
      // Only log as error if this is supposed to be a Microsoft account
      console.log("msgraph service not found (expected for Google account)");
    } else if (msgraphData.error) {
      errors.push(`Msgraph: ${msgraphData.error}`);
    } else {
      console.log(`Msgraph service has ${msgraphData.allMethodCount || 0} total methods`);
      console.log(`Calendar-related methods: ${msgraphData.methods?.join(", ") || "none"}`);
    }

    // Step 5: Check backend service for calendar methods
    console.log("\nChecking backend service for calendar methods...");
    const backendResult = await Runtime.evaluate({
      expression: `
        (() => {
          const backend = window.GoogleAccount?.backend;
          if (!backend) return { methods: [], error: "backend not found" };

          const allMethods = Object.keys(backend).filter(k => typeof backend[k] === 'function');
          const calendarMethods = allMethods.filter(k =>
            k.toLowerCase().includes('calendar') ||
            k.toLowerCase().includes('event') ||
            k.toLowerCase().includes('meeting') ||
            k.toLowerCase().includes('schedule') ||
            k.toLowerCase().includes('rsvp')
          );

          return { methods: calendarMethods, allMethodCount: allMethods.length };
        })()
      `,
      returnByValue: true,
    });

    const backendData = backendResult.result.value as {
      methods: string[];
      allMethodCount?: number;
      error?: string;
    };

    if (backendData.error) {
      errors.push(`Backend: ${backendData.error}`);
    }

    console.log(`Backend has ${backendData.allMethodCount || 0} total methods`);
    console.log(`Calendar-related methods: ${backendData.methods?.join(", ") || "none"}`);

    // Step 6: Check portal services
    console.log("\nChecking portal services...");
    const portalResult = await Runtime.evaluate({
      expression: `
        (() => {
          const portal = window.GoogleAccount?.portal;
          if (!portal) return { services: [], error: "portal not found" };

          // Try to find portal service registry
          const services = [];

          // Common portal service names
          const commonServices = [
            'threadInternal', 'messageInternal', 'labelInternal',
            'calendarInternal', 'eventInternal', 'meetingInternal',
            'calendar', 'events', 'meetings'
          ];

          return { services: commonServices, note: "Cannot enumerate portal services - need to test each" };
        })()
      `,
      returnByValue: true,
    });

    const portalData = portalResult.result.value as {
      services?: string[];
      note?: string;
      error?: string;
    };

    // Step 7: Check ViewState for calendar-related state
    console.log("\nChecking ViewState for calendar state...");
    const viewStateResult = await Runtime.evaluate({
      expression: `
        (() => {
          const vs = window.ViewState;
          if (!vs) return { state: null, error: "ViewState not found" };

          const calendarKeys = Object.keys(vs).filter(k =>
            k.toLowerCase().includes('calendar') ||
            k.toLowerCase().includes('event') ||
            k.toLowerCase().includes('meeting')
          );

          const calendarState = {};
          for (const key of calendarKeys) {
            try {
              const value = vs[key];
              if (value !== undefined) {
                calendarState[key] = typeof value === 'object' ?
                  Object.keys(value || {}) : typeof value;
              }
            } catch (e) {}
          }

          return { calendarKeys, calendarState };
        })()
      `,
      returnByValue: true,
    });

    const viewStateData = viewStateResult.result.value as {
      calendarKeys?: string[];
      calendarState?: Record<string, unknown>;
      error?: string;
    };

    console.log(`ViewState calendar keys: ${viewStateData.calendarKeys?.join(", ") || "none"}`);

    // Step 8: Try to list calendar events directly
    console.log("\nAttempting to list calendar events...");
    const eventsResult = await Runtime.evaluate({
      expression: `
        (async () => {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          const portal = ga?.portal;

          // Try various methods to list events

          // Method 1: Direct calendar service
          const calendarSvc = di?.get?.('calendar');
          if (calendarSvc?.getEvents) {
            try {
              const events = await calendarSvc.getEvents();
              return { method: 'calendar.getEvents', success: true, count: events?.length };
            } catch (e) {
              // Continue trying
            }
          }

          // Method 2: Gmail calendar
          const gmail = di?.get?.('gmail');
          if (gmail?.getCalendarEvents) {
            try {
              const events = await gmail.getCalendarEvents();
              return { method: 'gmail.getCalendarEvents', success: true, count: events?.length };
            } catch (e) {}
          }

          // Method 3: Portal invoke
          if (portal?.invoke) {
            try {
              const result = await portal.invoke('calendarInternal', 'listAsync', []);
              return { method: 'portal.calendarInternal.listAsync', success: true, result };
            } catch (e) {}

            try {
              const result = await portal.invoke('calendar', 'list', []);
              return { method: 'portal.calendar.list', success: true, result };
            } catch (e) {}
          }

          // Method 4: Check if there's a calendarController in ViewState
          const vs = window.ViewState;
          if (vs?.calendarController) {
            const ctrl = vs.calendarController;
            const methods = Object.keys(ctrl).filter(k => typeof ctrl[k] === 'function');
            return { method: 'ViewState.calendarController', methods };
          }

          return { success: false, message: "No calendar event listing method found" };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    const eventsData = eventsResult.result.value as {
      method?: string;
      success?: boolean;
      count?: number;
      methods?: string[];
      message?: string;
    };

    if (eventsData.success) {
      console.log(`Successfully listed events via ${eventsData.method}`);
      console.log(`Event count: ${eventsData.count}`);
    } else if (eventsData.methods) {
      console.log(`Found calendar controller with methods: ${eventsData.methods.join(", ")}`);
    } else {
      console.log(`No direct event listing found: ${eventsData.message}`);
    }

    // Compile results
    const result: DiscoveryResult = {
      timestamp: new Date().toISOString(),
      accountType: diData.isMicrosoft ? "microsoft" : "google",
      diServices: diData.foundServices || [],
      gmailCalendarMethods: gmailData.methods || [],
      msgraphCalendarMethods: msgraphData.methods || [],
      backendCalendarMethods: backendData.methods || [],
      portalServices: portalData.services || [],
      calendarViewState: viewStateData.calendarState || null,
      errors,
    };

    // Write results to file
    const outputPath = "docs/api/calendar-discovery.json";
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nResults written to ${outputPath}`);

    // Print summary
    console.log("\n=== Discovery Summary ===");
    console.log(`Account Type: ${result.accountType}`);
    console.log(`DI Services Found: ${result.diServices.map(s => s.name).join(", ") || "none"}`);
    console.log(`Gmail Calendar Methods: ${result.gmailCalendarMethods.join(", ") || "none"}`);
    console.log(`Msgraph Calendar Methods: ${result.msgraphCalendarMethods.join(", ") || "none"}`);
    console.log(`Backend Calendar Methods: ${result.backendCalendarMethods.join(", ") || "none"}`);
    console.log(`Errors: ${result.errors.length > 0 ? result.errors.join("; ") : "none"}`);

  } finally {
    // Close calendar view
    await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
    await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });

    await disconnect(conn);
  }
}

// Run discovery
discoverCalendarApis().catch(console.error);
