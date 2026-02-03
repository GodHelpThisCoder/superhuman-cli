#!/usr/bin/env bun
import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function find() {
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

        if (!gcal) {
          return { error: "No gcal service" };
        }

        try {
          const timeMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

          // Correct signature: getEventsList({calendarId, calendarAccountEmail}, options)
          const events = await gcal.getEventsList(
            { calendarId: accountEmail, calendarAccountEmail: accountEmail },
            { timeMin, timeMax, singleEvents: true, orderBy: 'startTime' }
          );

          const items = events?.items || events || [];
          const testEvents = items.filter(e =>
            e.summary?.toLowerCase().includes('test') ||
            e.summary?.toLowerCase().includes('cli')
          );

          return {
            account: accountEmail,
            total: items.length,
            testEvents: testEvents.map(e => ({
              id: e.id,
              summary: e.summary,
              start: e.start
            }))
          };
        } catch (e) {
          return { error: e.message, stack: e.stack?.slice(0, 300) };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("Result:", JSON.stringify(result.result.value, null, 2));

  // Delete each test event
  const testEvents = result.result.value?.testEvents || [];
  if (testEvents.length > 0) {
    console.log(`\nDeleting ${testEvents.length} test events...`);
    for (const event of testEvents) {
      console.log(`Deleting: ${event.summary} (${event.id})`);
      const delResult = await Runtime.evaluate({
        expression: `
          (async () => {
            const ga = window.GoogleAccount;
            const gcal = ga?.di?.get?.('gcal');
            const accountEmail = ga?.emailAddress;
            try {
              await gcal.deleteEvent(
                { calendarId: accountEmail, calendarAccountEmail: accountEmail },
                ${JSON.stringify(event.id)}
              );
              return { success: true };
            } catch (e) {
              return { error: e.message };
            }
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });
      console.log("  ->", JSON.stringify(delResult.result.value));
    }
  }

  await disconnect(conn);
}

find().catch(console.error);
