#!/usr/bin/env bun
/**
 * Explore how to create calendar events with Microsoft Graph
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function explore() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Could not connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  console.log("=== Exploring Microsoft Graph Calendar Create ===\n");

  // First verify we're on a Microsoft account
  const accountCheck = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        return {
          email: ga?.emailAddress,
          isMicrosoft: di?.get?.('isMicrosoft'),
          hasMsgraph: !!di?.get?.('msgraph')
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("Account:", JSON.stringify(accountCheck.result.value, null, 2));

  if (!accountCheck.result.value?.isMicrosoft) {
    console.log("\nNot a Microsoft account. Switch to Outlook and try again.");
    await disconnect(conn);
    return;
  }

  // Explore msgraph methods thoroughly
  const methodsResult = await Runtime.evaluate({
    expression: `
      (() => {
        const di = window.GoogleAccount?.di;
        const msgraph = di?.get?.('msgraph');
        if (!msgraph) return { error: 'No msgraph' };

        const methods = [];
        let obj = msgraph;
        while (obj && obj !== Object.prototype) {
          for (const p of Object.getOwnPropertyNames(obj)) {
            try {
              if (typeof msgraph[p] === 'function' && !methods.includes(p)) {
                methods.push(p);
              }
            } catch {}
          }
          obj = Object.getPrototypeOf(obj);
        }

        // Get source of relevant methods
        const sources = {};
        const relevantMethods = ['createEvent', 'insertEvent', 'addEvent', 'postEvent',
                                  '_postAsync', '_fetchWithRetry', 'fetchWithRetry',
                                  'updateEvent', '_patchAsync', 'post', 'fetch'];
        for (const m of relevantMethods) {
          if (msgraph[m]) {
            sources[m] = msgraph[m].toString().slice(0, 500);
          }
        }

        return {
          allMethods: methods.sort(),
          sources
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\nMsgraph methods:", JSON.stringify(methodsResult.result.value, null, 2));

  // Try to find a _postAsync or _fetchWithRetry method
  const fetchMethodResult = await Runtime.evaluate({
    expression: `
      (() => {
        const di = window.GoogleAccount?.di;
        const msgraph = di?.get?.('msgraph');
        if (!msgraph) return { error: 'No msgraph' };

        // Look for internal fetch/post methods
        const fetchMethods = [];
        let obj = msgraph;
        while (obj && obj !== Object.prototype) {
          for (const p of Object.getOwnPropertyNames(obj)) {
            const lower = p.toLowerCase();
            if ((lower.includes('fetch') || lower.includes('post') || lower.includes('request') || lower.includes('http')) && typeof msgraph[p] === 'function') {
              fetchMethods.push({
                name: p,
                src: msgraph[p].toString().slice(0, 300)
              });
            }
          }
          obj = Object.getPrototypeOf(obj);
        }

        return { fetchMethods };
      })()
    `,
    returnByValue: true,
  });

  console.log("\nFetch methods:", JSON.stringify(fetchMethodResult.result.value, null, 2));

  // Look at the prototype chain to find the base class methods
  const baseMethodsResult = await Runtime.evaluate({
    expression: `
      (() => {
        const di = window.GoogleAccount?.di;
        const msgraph = di?.get?.('msgraph');
        if (!msgraph) return { error: 'No msgraph' };

        // Check if there's a base HTTP client
        const props = {};
        for (const p of ['_client', '_http', '_api', '_fetch', 'client', 'http', 'api']) {
          if (msgraph[p]) {
            props[p] = typeof msgraph[p];
            if (typeof msgraph[p] === 'object') {
              props[p + '_keys'] = Object.keys(msgraph[p]).slice(0, 20);
            }
          }
        }

        // Check constructor
        props.constructorName = msgraph.constructor?.name;

        return props;
      })()
    `,
    returnByValue: true,
  });

  console.log("\nBase methods/props:", JSON.stringify(baseMethodsResult.result.value, null, 2));

  // Let's look at updateEvent signature more closely - maybe we can use it differently
  const updateEventResult = await Runtime.evaluate({
    expression: `
      (() => {
        const di = window.GoogleAccount?.di;
        const msgraph = di?.get?.('msgraph');
        if (!msgraph?.updateEvent) return { error: 'No updateEvent' };

        return {
          fullSource: msgraph.updateEvent.toString()
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\nupdateEvent full source:", JSON.stringify(updateEventResult.result.value, null, 2));

  // Get the calendars first to get calendarId
  console.log("\n=== Getting calendars ===\n");

  const calendarsResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const msgraph = di?.get?.('msgraph');
        const accountEmail = ga?.emailAddress;

        if (!msgraph?.getCalendars) {
          return { error: 'No getCalendars method' };
        }

        try {
          const calendars = await msgraph.getCalendars(accountEmail);
          return {
            calendars: (calendars || []).map(c => ({
              id: c.id,
              name: c.name,
              isDefault: c.isDefaultCalendar
            }))
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("Calendars:", JSON.stringify(calendarsResult.result.value, null, 2));

  // Try direct fetch to Graph API
  console.log("\n=== Testing direct POST to Graph API ===\n");

  const directPostResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const msgraph = di?.get?.('msgraph');
        const accountEmail = ga?.emailAddress;

        // Get default calendar
        let calendarId = null;
        try {
          const calendars = await msgraph.getCalendars(accountEmail);
          const primary = calendars?.find(c => c.isDefaultCalendar) || calendars?.[0];
          calendarId = primary?.id;
        } catch {}

        if (!calendarId) {
          return { error: 'Could not get calendar ID' };
        }

        const testEvent = {
          subject: 'Test Event from CLI ' + Date.now(),
          start: {
            dateTime: new Date(Date.now() + 3600000).toISOString().replace('Z', ''),
            timeZone: 'America/New_York'
          },
          end: {
            dateTime: new Date(Date.now() + 7200000).toISOString().replace('Z', ''),
            timeZone: 'America/New_York'
          }
        };

        // Look for any method that can POST to Graph API
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(msgraph));
        const fetchLike = methods.filter(m =>
          m.toLowerCase().includes('fetch') ||
          m.toLowerCase().includes('post') ||
          m.toLowerCase().includes('request')
        );

        // Try using _fetchWithRetry if it exists
        if (msgraph._fetchWithRetry) {
          try {
            const url = '/v1.0/me/calendars/' + calendarId + '/events';
            const result = await msgraph._fetchWithRetry(url, {
              method: 'POST',
              body: JSON.stringify(testEvent),
              headers: { 'Content-Type': 'application/json' }
            });
            return { success: true, result, method: '_fetchWithRetry' };
          } catch (e) {
            return { error: e.message, method: '_fetchWithRetry', stack: e.stack?.slice(0, 300) };
          }
        }

        return {
          error: 'No suitable POST method found',
          fetchLikeMethods: fetchLike,
          calendarId,
          testEvent
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("Direct POST result:", JSON.stringify(directPostResult.result.value, null, 2));

  // Look for addEvent or similar methods
  console.log("\n=== Looking for any create-like methods ===\n");

  const createMethodsResult = await Runtime.evaluate({
    expression: `
      (() => {
        const di = window.GoogleAccount?.di;
        const msgraph = di?.get?.('msgraph');
        if (!msgraph) return { error: 'No msgraph' };

        const createMethods = {};
        let obj = msgraph;
        while (obj && obj !== Object.prototype) {
          for (const p of Object.getOwnPropertyNames(obj)) {
            const lower = p.toLowerCase();
            if ((lower.includes('create') || lower.includes('add') || lower.includes('insert') || lower.includes('new')) && typeof msgraph[p] === 'function') {
              createMethods[p] = msgraph[p].toString().slice(0, 400);
            }
          }
          obj = Object.getPrototypeOf(obj);
        }

        return createMethods;
      })()
    `,
    returnByValue: true,
  });

  console.log("Create methods:", JSON.stringify(createMethodsResult.result.value, null, 2));

  await disconnect(conn);
}

explore().catch(console.error);
