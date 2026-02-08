
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function verifyDraft() {
  console.log("=== Verifying Draft State After CLI ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Check what's in the compose form controller
  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "No cfc" };

        const keys = Object.keys(cfc).filter(k => k.startsWith('draft'));

        const drafts = keys.map(key => {
          const ctrl = cfc[key];
          const draft = ctrl?.state?.draft;
          return {
            key,
            draftId: draft?.id,
            subject: draft?.subject,
            to: (draft?.to || []).map(r => r.email),
            cc: (draft?.cc || []).map(r => r.email),
            body: draft?.body,
            from: draft?.from?.email,
            dirty: draft?.dirty
          };
        });

        return {
          totalDrafts: keys.length,
          drafts
        };
      })()
    `,
    returnByValue: true
  });

  console.log("Current draft state in Superhuman:");
  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

verifyDraft().catch(console.error);
