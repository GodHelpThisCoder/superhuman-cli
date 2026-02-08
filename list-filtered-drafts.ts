
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function checkAccountAndDrafts() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          const isMicrosoft = di?.get?.('isMicrosoft') || false;
          const email = ga?.emailAddress || ga?.account?.emailAddress || '';

          let drafts = [];

          if (isMicrosoft) {
            const msgraph = di.get?.('msgraph');
            const response = await msgraph._fetchJSONWithRetry(
              'https://graph.microsoft.com/v1.0/me/mailFolders/Drafts/messages?$select=id,subject,toRecipients,receivedDateTime,bodyPreview',
              { method: 'GET', endpoint: 'mail.listDrafts' }
            );
            drafts = (response.value || []).map(m => ({
              id: m.id,
              subject: m.subject,
              to: m.toRecipients?.map(r => r.emailAddress?.address).join(', '),
              date: m.receivedDateTime,
              snippet: m.bodyPreview
            }));
          } else {
            const gmail = di.get?.('gmail');
            const response = await gmail._getAsync(
              'https://www.googleapis.com/gmail/v1/users/me/drafts',
              {},
              { calendarAccountEmail: email, endpoint: 'gmail.drafts.list' }
            );
            if (response.drafts) {
              for (const draft of response.drafts) {
                const detail = await gmail._getAsync(
                  'https://www.googleapis.com/gmail/v1/users/me/drafts/' + draft.id,
                  {},
                  { calendarAccountEmail: email, endpoint: 'gmail.drafts.get' }
                );
                drafts.push({
                  id: draft.id,
                  subject: detail?.message?.payload?.headers?.find(h => h.name === 'Subject')?.value,
                  to: detail?.message?.payload?.headers?.find(h => h.name === 'To')?.value,
                  date: detail?.message?.payload?.headers?.find(h => h.name === 'Date')?.value,
                  snippet: detail?.message?.snippet
                });
              }
            }
          }

          return { email, isMicrosoft, drafts };
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

checkAccountAndDrafts().catch(console.error);
