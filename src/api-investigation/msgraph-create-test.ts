#!/usr/bin/env bun
/**
 * Test creating calendar events with Microsoft Graph using _fetchJSONWithRetry
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function test() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Could not connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  console.log("=== Testing Microsoft Graph Calendar Create ===\n");

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const msgraph = di?.get?.('msgraph');
        const accountEmail = ga?.emailAddress;

        if (!di?.get?.('isMicrosoft')) {
          return { error: 'Not a Microsoft account' };
        }

        // Get default calendar
        let calendarId = null;
        try {
          const calendars = await msgraph.getCalendars(accountEmail);
          const primary = calendars?.find(c => c.isDefaultCalendar) || calendars?.[0];
          calendarId = primary?.id;
        } catch (e) {
          return { error: 'Could not get calendars: ' + e.message };
        }

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

        // Try using _fetchJSONWithRetry like createFolder does
        try {
          const url = msgraph._fullURL('/v1.0/me/calendars/' + calendarId + '/events', {});
          const created = await msgraph._fetchJSONWithRetry(url, {
            method: 'POST',
            body: JSON.stringify(testEvent),
            headers: { 'Content-Type': 'application/json' },
            endpoint: 'events.create',
            proxy: true,
            calendarAccount: accountEmail
          });
          return { success: true, eventId: created?.id, method: '_fetchJSONWithRetry', created };
        } catch (e) {
          return { error: e.message, stack: e.stack?.slice(0, 500), method: '_fetchJSONWithRetry' };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("Result:", JSON.stringify(result.result.value, null, 2));

  // If that didn't work, try without proxy
  if (!result.result.value?.success) {
    console.log("\n=== Trying without proxy flag ===\n");

    const result2 = await Runtime.evaluate({
      expression: `
        (async () => {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          const msgraph = di?.get?.('msgraph');
          const accountEmail = ga?.emailAddress;

          // Get default calendar
          let calendarId = null;
          const calendars = await msgraph.getCalendars(accountEmail);
          const primary = calendars?.find(c => c.isDefaultCalendar) || calendars?.[0];
          calendarId = primary?.id;

          const testEvent = {
            subject: 'Test Event from CLI (no proxy) ' + Date.now(),
            start: {
              dateTime: new Date(Date.now() + 3600000).toISOString().replace('Z', ''),
              timeZone: 'America/New_York'
            },
            end: {
              dateTime: new Date(Date.now() + 7200000).toISOString().replace('Z', ''),
              timeZone: 'America/New_York'
            }
          };

          try {
            const url = msgraph._fullURL('/v1.0/me/calendars/' + calendarId + '/events', {});
            const created = await msgraph._fetchJSONWithRetry(url, {
              method: 'POST',
              body: JSON.stringify(testEvent),
              headers: { 'Content-Type': 'application/json' },
              endpoint: 'events.create'
            });
            return { success: true, eventId: created?.id, method: '_fetchJSONWithRetry no proxy', created };
          } catch (e) {
            return { error: e.message, stack: e.stack?.slice(0, 500) };
          }
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    console.log("Result 2:", JSON.stringify(result2.result.value, null, 2));
  }

  await disconnect(conn);
}

test().catch(console.error);
