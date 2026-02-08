
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function fixDraftNewlines(draftId: string) {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          const msgraph = di.get?.('msgraph');
          
          // Get current draft
          const draft = await msgraph._fetchJSONWithRetry(
            'https://graph.microsoft.com/v1.0/me/messages/' + ${JSON.stringify(draftId)},
            { method: 'GET', endpoint: 'mail.getDraft' }
          );
          
          if (!draft?.body?.content) return { error: "No body content" };
          
          let content = draft.body.content;
          
          // Replace literal \\n with actual HTML line breaks or paragraphs
          // First, check if it's already wrapped in <p>
          if (content.includes('<p>') && content.includes('</p>')) {
             // Inside <p>, replace \\n\\n with </p><p> and \\n with <br>
             content = content.replace(/\\\\n\\\\n/g, '</p><p>');
             content = content.replace(/\\\\n/g, '<br>');
          } else {
             // Not wrapped, wrap it and replace
             content = '<p>' + content.replace(/\\\\n\\\\n/g, '</p><p>').replace(/\\\\n/g, '<br>') + '</p>';
          }
          
          // Update draft
          const response = await msgraph._fetchJSONWithRetry(
            'https://graph.microsoft.com/v1.0/me/messages/' + ${JSON.stringify(draftId)},
            {
              method: 'PATCH',
              body: JSON.stringify({
                body: {
                  contentType: 'html',
                  content: content
                }
              }),
              headers: { 'Content-Type': 'application/json' },
              endpoint: 'mail.update'
            }
          );
          
          return { success: true, newContent: content };
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
  fixDraftNewlines(targetDraftId).catch(console.error);
} else {
  console.error("Usage: bun run fix-drafts-newlines.ts <draft-id>");
}
