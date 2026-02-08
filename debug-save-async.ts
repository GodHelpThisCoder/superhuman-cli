
import { connectToSuperhuman, disconnect, openCompose } from "./src/superhuman-api";

async function debugSaveAsync() {
  console.log("=== DEBUG: _saveDraftAsync Behavior ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Open compose
  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose, draftKey: "${draftKey}"`);

  // Set up the draft with content
  const setupResult = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        const draft = ctrl?.state?.draft;

        // Add recipient
        if (draft?.from?.constructor) {
          const Recipient = draft.from.constructor;
          const newR = new Recipient({ email: "asynctest@test.com", name: "Test", raw: "Test <asynctest@test.com>" });
          ctrl._updateDraft({ to: [newR] });
        }

        // Set subject
        ctrl.setSubject("Async Test Subject");

        // Set body
        ctrl._updateDraft({ body: "<p>Async test body content</p>" });

        return {
          before_save: {
            subject: draft?.subject,
            body: draft?.body,
            to: (draft?.to || []).map(r => r.email)
          }
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("2. After setting content:");
  console.log(JSON.stringify(setupResult.result.value, null, 2));

  // Now test _saveDraftAsync - does it return a promise? What happens?
  const saveResult = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        const draft = ctrl?.state?.draft;

        // Check if _saveDraftAsync returns a promise
        const result = ctrl._saveDraftAsync();
        const isPromise = result instanceof Promise || (result && typeof result.then === 'function');

        let awaited = null;
        if (isPromise) {
          try {
            awaited = await result;
          } catch (e) {
            awaited = "error: " + e.message;
          }
        }

        return {
          saveDraftAsyncReturns: typeof result,
          isPromise,
          awaitedResult: awaited,
          afterSaveSubject: draft?.subject,
          afterSaveBody: draft?.body,
          afterSaveTo: (draft?.to || []).map(r => r.email)
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("3. After _saveDraftAsync:");
  console.log(JSON.stringify(saveResult.result.value, null, 2));

  // Wait a bit and check again
  console.log("\n4. Waiting 3 seconds...");
  await new Promise(r => setTimeout(r, 3000));

  const checkResult = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc?.[draftKey];
        const draft = ctrl?.state?.draft;

        return {
          controllerStillExists: !!ctrl,
          afterWait: {
            subject: draft?.subject,
            body: draft?.body,
            to: (draft?.to || []).map(r => r.email),
            draftId: draft?.id
          }
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("5. After waiting:");
  console.log(JSON.stringify(checkResult.result.value, null, 2));

  await disconnect(conn);
}

debugSaveAsync().catch(console.error);
