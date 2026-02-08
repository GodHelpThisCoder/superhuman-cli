
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugSaveInProgress() {
  console.log("=== Checking Save In Progress State ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Enable network
  await conn.Network.enable();
  let networkRequests: any[] = [];
  conn.Network.requestWillBeSent((params) => {
    networkRequests.push({
      time: Date.now(),
      url: params.request.url,
      method: params.request.method
    });
  });

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  // Check initial debouncer state
  let state = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        const debouncer = ctrl._debouncer;
        return {
          _inProgressPromises: Object.keys(debouncer._inProgressPromises || {}),
          _queuedUp: Object.keys(debouncer._queuedUp || {}),
          _running: Object.keys(debouncer._running || {}),
        };
      })()
    `,
    returnByValue: true
  });
  console.log("2. Initial debouncer state:", JSON.stringify(state.result.value));

  // Populate draft
  await addRecipient(conn, "progress-test@test.com", undefined, draftKey!);
  await setSubject(conn, "Progress Test", draftKey!);
  await setBody(conn, textToHtml("Progress test body"), draftKey!);
  console.log("3. Populated draft");

  // Check debouncer state after populate
  state = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        const debouncer = ctrl._debouncer;
        return {
          _inProgressPromises: Object.keys(debouncer._inProgressPromises || {}),
          _queuedUp: Object.keys(debouncer._queuedUp || {}),
          _running: Object.keys(debouncer._running || {}),
        };
      })()
    `,
    returnByValue: true
  });
  console.log("4. After populate debouncer state:", JSON.stringify(state.result.value));

  // Wait a bit
  await new Promise(r => setTimeout(r, 2000));

  state = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        const debouncer = ctrl._debouncer;
        return {
          _inProgressPromises: Object.keys(debouncer._inProgressPromises || {}),
          _queuedUp: Object.keys(debouncer._queuedUp || {}),
          _running: Object.keys(debouncer._running || {}),
        };
      })()
    `,
    returnByValue: true
  });
  console.log("5. After 2s wait debouncer state:", JSON.stringify(state.result.value));

  // Check what's in _inProgressPromises
  const inProgress = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        const debouncer = ctrl._debouncer;

        const promises = debouncer._inProgressPromises;
        const result = {};
        for (const key of Object.keys(promises || {})) {
          const p = promises[key];
          result[key] = {
            type: typeof p,
            isPromise: p instanceof Promise,
            resolved: null
          };
          // Try to check if resolved
          if (p instanceof Promise) {
            p.then(() => {}).catch(() => {});
          }
        }
        return result;
      })()
    `,
    returnByValue: true
  });
  console.log("6. In-progress promises:", JSON.stringify(inProgress.result.value));

  // Now try awaiting the promise directly
  console.log("\n7. Trying to await the in-progress promise...");
  const awaitResult = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        const debouncer = ctrl._debouncer;

        const savePromise = debouncer._inProgressPromises?.saveDraft;
        if (!savePromise) {
          return { error: "No saveDraft promise" };
        }

        try {
          const result = await savePromise;
          return { success: true, result: result === undefined ? "undefined" : JSON.stringify(result) };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });
  console.log("8. Await result:", JSON.stringify(awaitResult.result.value));

  // Check network after waiting
  const postReqs = networkRequests.filter(r => r.method !== 'GET');
  console.log("9. Non-GET requests:", JSON.stringify(postReqs, null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

debugSaveInProgress().catch(console.error);
