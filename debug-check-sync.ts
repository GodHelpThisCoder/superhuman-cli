
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function checkSync() {
  console.log("=== Checking Draft Sync Status ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Look for the draft in the actual message store
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          // First, get the draft from compose controller
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return { error: "No cfc" };

          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return { error: "No draft key" };

          const ctrl = cfc[draftKey];
          const draft = ctrl?.state?.draft;

          // Check the draft object structure
          const draftInfo = {
            id: draft?.id,
            subject: draft?.subject,
            body: draft?.body?.substring(0, 100),
            to: (draft?.to || []).map(r => r.email),
            from: draft?.from?.email,
            dirty: draft?.dirty,
            isSaving: draft?.isSaving,
            savedAt: draft?.savedAt,
            messageId: draft?.messageId,
            threadId: draft?.threadId,
            hasAllProps: Object.keys(draft || {})
          };

          // Try to see if saveDraftAsync was called and completed
          const controllerState = {
            isSaving: ctrl?.isSaving,
            lastSaveError: ctrl?.lastSaveError,
          };

          return {
            draftKey,
            draftInfo,
            controllerState
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("Draft and sync state:");
  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

checkSync().catch(console.error);
