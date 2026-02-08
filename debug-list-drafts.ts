
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function listDrafts() {
  console.log("=== Listing All Drafts via Gmail API ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Try to list drafts using the Gmail API through Superhuman
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          if (!ga) return { error: "No GoogleAccount" };

          const di = ga.di;
          const accountEmail = ga.emailAddress;

          // Check if this is a Microsoft account
          const isMicrosoft = di.get?.('isMicrosoft');
          if (isMicrosoft) {
            return { error: "Microsoft account - would need different API" };
          }

          // Try to get drafts via Gmail API
          const gmail = di.get?.('gmail');

          // Attempt to fetch drafts
          const draftsResponse = await gmail._getAsync?.(
            'https://www.googleapis.com/gmail/v1/users/me/drafts',
            {},
            { calendarAccountEmail: accountEmail, endpoint: 'gmail.drafts.list', allowCachedResponses: false }
          );

          if (!draftsResponse?.drafts) {
            return { error: "No drafts found or API failed", response: draftsResponse };
          }

          // Get details for each draft
          const draftsWithDetails = [];
          for (const draft of draftsResponse.drafts.slice(0, 5)) { // Limit to 5 for testing
            try {
              const draftDetail = await gmail._getAsync?.(
                'https://www.googleapis.com/gmail/v1/users/me/drafts/' + draft.id,
                {},
                { calendarAccountEmail: accountEmail, endpoint: 'gmail.drafts.get', allowCachedResponses: false }
              );

              draftsWithDetails.push({
                id: draft.id,
                messageId: draftDetail?.message?.id,
                threadId: draftDetail?.message?.threadId,
                subject: draftDetail?.message?.payload?.headers?.find(h => h.name === 'Subject')?.value,
                to: draftDetail?.message?.payload?.headers?.find(h => h.name === 'To')?.value,
                snippet: draftDetail?.message?.snippet?.substring(0, 50)
              });
            } catch (e) {
              draftsWithDetails.push({ id: draft.id, error: e.message });
            }
          }

          return {
            totalDrafts: draftsResponse.drafts.length,
            draftsWithDetails
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("Drafts from Gmail API:");
  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

listDrafts().catch(console.error);
