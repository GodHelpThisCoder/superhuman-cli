
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugSaveMethod() {
  console.log("=== Understanding _saveDraftAsync ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  await addRecipient(conn, "method-test@test.com", undefined, draftKey!);
  await setSubject(conn, "Method Test Subject", draftKey!);
  await setBody(conn, textToHtml("Method test body"), draftKey!);
  console.log("2. Set content");

  // Look at what _saveDraftAsync actually does
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];

        if (!ctrl) return { error: "No controller" };

        // Get the function source
        const saveFnSource = ctrl._saveDraftAsync?.toString?.()?.substring(0, 500);
        const saveFnName = ctrl._saveDraftAsync?.name;

        // Check for other save methods
        const allMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(ctrl)).filter(n => n.toLowerCase().includes('save') || n.toLowerCase().includes('sync') || n.toLowerCase().includes('submit'));

        // Check draft state before save
        const draft = ctrl.state?.draft;
        const beforeSave = {
          dirty: draft?.dirty,
          subject: draft?.subject,
          to: (draft?.to || []).map(r => r.email),
          body: draft?.body?.substring(0, 50)
        };

        // Try calling _saveDraftAsync and see what it returns
        let saveResult = null;
        let saveError = null;
        try {
          saveResult = await ctrl._saveDraftAsync();
        } catch (e) {
          saveError = e.message;
        }

        // Check draft state after save
        const afterSave = {
          dirty: draft?.dirty,
          subject: draft?.subject,
          to: (draft?.to || []).map(r => r.email),
          body: draft?.body?.substring(0, 50)
        };

        return {
          saveFnName,
          saveFnSource,
          allMethods,
          beforeSave,
          saveResult: saveResult === undefined ? "undefined" : saveResult,
          saveError,
          afterSave
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("3. Save method analysis:");
  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

debugSaveMethod().catch(console.error);
