
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function verifyFamilyEvent() {
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
          
          const events = await gcal.getEventsList(
            { calendarId, calendarAccountEmail: accountEmail },
            { timeMin: "2026-02-18T00:00:00Z", timeMax: "2026-02-19T00:00:00Z" }
          );
          return { success: true, events: events?.items || events };
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

verifyFamilyEvent();
