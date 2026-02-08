
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function showDraftBody(draftId: string) {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          const msgraph = di.get?.('msgraph');
          const response = await msgraph._fetchJSONWithRetry(
            'https://graph.microsoft.com/v1.0/me/messages/' + ${JSON.stringify(draftId)},
            { method: 'GET', endpoint: 'mail.getDraft' }
          );
          return {
            contentType: response.body?.contentType,
            content: response.body?.content
          };
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

const targetDraftId = process.argv[2];
if (targetDraftId) {
  showDraftBody(targetDraftId).catch(console.error);
} else {
  console.error("Usage: bun run show-draft-body.ts <draft-id>");
}
