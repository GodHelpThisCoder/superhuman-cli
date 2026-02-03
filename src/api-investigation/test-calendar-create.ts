#!/usr/bin/env bun
import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function test() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Could not connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  const r = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const gcal = ga?.di?.get?.('gcal');
        const accountEmail = ga?.emailAddress;

        const testEvent = {
          summary: 'Test Event from CLI ' + Date.now(),
          start: { dateTime: new Date(Date.now() + 3600000).toISOString(), timeZone: 'America/New_York' },
          end: { dateTime: new Date(Date.now() + 7200000).toISOString(), timeZone: 'America/New_York' }
        };

        // Debug: check what values we have
        const debug = {
          accountEmail,
          hasGcal: !!gcal,
          hasPostAsync: typeof gcal?._postAsync === 'function',
          gaKeys: Object.keys(ga || {}),
          accountKeys: Object.keys(ga?.account || {})
        };

        if (!accountEmail) {
          return { error: 'accountEmail is undefined', debug };
        }

        try {
          // Call _postAsync directly with correct options
          const url = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(accountEmail) + '/events';
          const opts = {
            calendarAccountEmail: accountEmail,
            endpoint: 'gcal.events.insert'
          };
          const result = await gcal._postAsync(url, testEvent, opts);
          return { success: true, eventId: result?.id, htmlLink: result?.htmlLink };
        } catch (e) {
          return {
            error: e.message,
            stack: e.stack?.slice(0, 500),
            debug
          };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log(JSON.stringify(r.result.value, null, 2));
  await disconnect(conn);
}

test();
