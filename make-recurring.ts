
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function makeRecurring(eventId: string) {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const msgraph = ga?.di?.get?.('msgraph');
          if (!msgraph) return { error: "msgraph service not found" };

          const url = msgraph._fullURL('/v1.0/me/messages/' + ${JSON.stringify(eventId)}, {});
          // Actually messages endpoint isn't right for calendar, should be events
          const eventUrl = 'https://graph.microsoft.com/v1.0/me/events/' + ${JSON.stringify(eventId)};
          
          const patchBody = {
            recurrence: {
              pattern: {
                type: 'weekly',
                interval: 1,
                daysOfWeek: ['tuesday']
              },
              range: {
                type: 'noEnd',
                startDate: '2026-02-03'
              }
            }
          };

          const response = await msgraph._fetchJSONWithRetry(eventUrl, {
            method: 'PATCH',
            body: JSON.stringify(patchBody),
            headers: { 'Content-Type': 'application/json' },
            endpoint: 'events.update'
          });

          return { success: true, response };
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

makeRecurring("AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0AXIqdBgk1EkKJ_kY4ZzlqaQABlgCZBQAA").catch(console.error);
