
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function draftStorage() {
  console.log("=== Checking Superhuman Draft Storage ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Look for internal storage mechanisms
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          if (!ga) return { error: "No GoogleAccount" };

          const di = ga.di;
          const accountEmail = ga.emailAddress;

          // Look for draft stores
          const draftStore = di.get?.('draftStore');
          const messageStore = di.get?.('messageStore');
          const threadStore = di.get?.('threadStore');

          // Check _composeFormController for the current draft
          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const ctrl = cfc?.[draftKey];
          const draft = ctrl?.state?.draft;

          // Check if the draft model has a save method we should observe
          const draftMethods = draft ? Object.getOwnPropertyNames(Object.getPrototypeOf(draft)).filter(n => n.includes('save') || n.includes('Save') || n.includes('sync') || n.includes('Sync')) : [];

          // Check controller for save-related methods
          const ctrlMethods = ctrl ? Object.getOwnPropertyNames(Object.getPrototypeOf(ctrl)).filter(n => n.includes('save') || n.includes('Save') || n.includes('sync') || n.includes('Sync') || n.includes('draft') || n.includes('Draft')) : [];

          // Check the actual save status
          const saveState = {
            draftStoreDefined: !!draftStore,
            messageStoreDefined: !!messageStore,
            threadStoreDefined: !!threadStore,
            draftMethods,
            ctrlMethods,
            draftDirty: draft?.dirty,
            ctrlIsSaving: ctrl?._isSaving,
            ctrlPendingSave: ctrl?._pendingSave,
          };

          return saveState;
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("Draft storage info:");
  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

draftStorage().catch(console.error);
