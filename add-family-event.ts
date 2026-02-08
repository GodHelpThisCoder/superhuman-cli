
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function addEventToFamily() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          const gcal = di?.get?.('gcal');
          const accountEmail = ga?.emailAddress;
          const calendarId = "family11935540803478838785@group.calendar.google.com";
          
          const event = {
            summary: "Chiro",
            start: { dateTime: "2026-02-18T11:45:00-05:00" },
            end: { dateTime: "2026-02-18T12:15:00-05:00" }
          };

          const url = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events';
          const created = await gcal._postAsync(url, event, {
            calendarAccountEmail: accountEmail,
            endpoint: 'gcal.events.insert'
          });
          return { success: true, eventId: created?.id };
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

addEventToFamily();
