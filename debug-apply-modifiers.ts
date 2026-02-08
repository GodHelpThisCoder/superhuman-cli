
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugApplyModifiers() {
  console.log("=== Trying applyModifiers ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Network monitoring
  await conn.Network.enable();
  let allRequests: any[] = [];
  conn.Network.requestWillBeSent((params) => {
    allRequests.push({
      time: Date.now(),
      url: params.request.url,
      method: params.request.method,
      postData: params.request.postData?.substring(0, 300)
    });
  });

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  await addRecipient(conn, "apply-test@test.com", undefined, draftKey!);
  await setSubject(conn, "Apply Modifiers Test", draftKey!);
  await setBody(conn, textToHtml("Apply modifiers test body"), draftKey!);
  console.log("2. Populated draft");

  // Call saveDraft first to queue the modifier
  await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        await ctrl._saveDraftAsync();
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });
  console.log("3. Called _saveDraftAsync");

  allRequests = [];

  // Now try applyModifiers
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];

        const draft = ctrl.state.draft;
        const props = ctrl.props;
        const account = props.account;
        const presenter = account.threads.getPresenter(ctrl.state.draftOp, draft.threadId);
        const modifierQueue = presenter.modifierQueue;

        const beforePending = modifierQueue?.getPendingLength?.();
        const beforeModifiers = modifierQueue?.getPendingModifiers?.()?.map(m => ({
          name: m.name,
          threadId: m.threadId
        }));

        // Try applyModifiers
        let applyResult = null;
        try {
          applyResult = await modifierQueue.applyModifiers?.();
        } catch (e) {
          applyResult = { error: e.message };
        }

        const afterPending = modifierQueue?.getPendingLength?.();

        // Also check waitUntilEmptyForTests
        let waitResult = null;
        try {
          await modifierQueue.waitUntilEmptyForTests?.();
          waitResult = 'completed';
        } catch (e) {
          waitResult = { error: e.message };
        }

        return {
          beforePending,
          beforeModifiers,
          applyResult: applyResult === undefined ? 'undefined' : applyResult,
          afterPending,
          waitResult
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("\n4. applyModifiers result:");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Wait for network
  console.log("\n5. Waiting for network...");
  await new Promise(r => setTimeout(r, 5000));

  console.log("6. Non-GET network requests:");
  const mutations = allRequests.filter(r => r.method !== 'GET');
  console.log(JSON.stringify(mutations.slice(0, 10), null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

debugApplyModifiers().catch(console.error);
