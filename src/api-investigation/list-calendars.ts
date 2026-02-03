#!/usr/bin/env bun
import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function listCalendars() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Could not connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const gcal = di?.get?.('gcal');
        const accountEmail = ga?.emailAddress;
        const isMicrosoft = di?.get?.('isMicrosoft');

        if (isMicrosoft) {
          const msgraph = di?.get?.('msgraph');
          const calendars = await msgraph.getCalendars(accountEmail);
          return {
            provider: 'microsoft',
            account: accountEmail,
            calendars: calendars?.map(c => ({
              id: c.id,
              name: c.name,
              isDefault: c.isDefaultCalendar,
              color: c.color
            }))
          };
        }

        // Google - use listCalendarList
        try {
          const calendarList = await gcal.listCalendarList({ calendarAccountEmail: accountEmail });
          return {
            provider: 'google',
            account: accountEmail,
            calendars: (calendarList?.items || calendarList || []).map(c => ({
              id: c.id,
              name: c.summary || c.summaryOverride,
              primary: c.primary,
              selected: c.selected,
              accessRole: c.accessRole,
              backgroundColor: c.backgroundColor
            }))
          };
        } catch (e) {
          return {
            provider: 'google',
            account: accountEmail,
            error: e.message,
            stack: e.stack?.slice(0, 300)
          };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

listCalendars().catch(console.error);
