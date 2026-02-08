
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function listCalendars() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          if (!di) return { error: "DI not found" };

          const isMicrosoft = di.get?.('isMicrosoft');
          const accountEmail = ga?.emailAddress;

          if (isMicrosoft) {
            const msgraph = di.get?.('msgraph');
            const calendars = await msgraph.getCalendars(accountEmail);
            return { provider: 'microsoft', calendars };
          } else {
            const gcal = di.get?.('gcal');
            try {
              const url = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
              const list = await gcal._getAsync(url, {}, { calendarAccountEmail: accountEmail, endpoint: 'gcal.calendarList.list', allowCachedResponses: true });
              return { provider: 'google', list };
            } catch (e) {
              return { provider: 'google', err: e.message };
            }
          }
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

listCalendars();
