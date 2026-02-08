
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugDebouncer() {
  console.log("=== Understanding Debouncer ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Enable network monitoring
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

  // Populate the draft
  await addRecipient(conn, "debouncer-test@test.com", undefined, draftKey!);
  await setSubject(conn, "Debouncer Test", draftKey!);
  await setBody(conn, textToHtml("Debouncer test body"), draftKey!);
  console.log("2. Populated draft");

  // Check debouncer
  const debouncerAnalysis = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];

        const debouncer = ctrl._debouncer;

        if (!debouncer) return { error: "No debouncer" };

        // Check state
        const state = {
          _inProgressPromises: debouncer._inProgressPromises ? Object.keys(debouncer._inProgressPromises) : [],
          _inProgressTimeouts: debouncer._inProgressTimeouts ? Object.keys(debouncer._inProgressTimeouts) : [],
          _inProgressOperations: debouncer._inProgressOperations ? Object.keys(debouncer._inProgressOperations) : [],
          _queuedUp: debouncer._queuedUp ? Object.keys(debouncer._queuedUp) : [],
          _running: debouncer._running,
        };

        // Check methods
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(debouncer));

        // throttleForOperation source
        const throttleSource = debouncer.throttleForOperation?.toString?.().substring(0, 800);

        return {
          state,
          methods,
          throttleSource
        };
      })()
    `,
    returnByValue: true
  });

  console.log("3. Debouncer analysis:");
  console.log(JSON.stringify(debouncerAnalysis.result.value, null, 2));

  // Now manually invoke throttleForOperation like _saveDraftAsync does
  console.log("\n4. Manually invoking throttleForOperation...");
  networkRequests = [];

  const throttleResult = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        const ctrlClass = ctrl.constructor;

        const debouncer = ctrl._debouncer;

        // Replicate what _saveDraftAsync does
        if (!ctrlClass.changesAllowed(ctrl.props, ctrl.state)) {
          return { error: "changesAllowed is false" };
        }

        // Log the call
        console.log('throttleForOperation about to be called');

        try {
          const result = await debouncer.throttleForOperation(
            "saveDraft",
            1000,  // 1 second delay
            ctrl.state.draftOp,
            (r) => {
              console.log('Callback being executed');
              return ctrlClass.saveDraft(r, ctrl.state.draft, ctrl.props, { saveSource: 'cli-manual' });
            }
          );
          return { success: true, result: result === undefined ? "undefined" : JSON.stringify(result) };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("5. throttleForOperation result:", JSON.stringify(throttleResult.result.value, null, 2));

  // Wait and watch
  console.log("\n6. Waiting 5 seconds...");
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    const postReqs = networkRequests.filter(r => r.method !== 'GET');
    if (postReqs.length > 0) {
      console.log(`Found ${postReqs.length} POST/PUT/PATCH requests`);
      break;
    }
  }

  const postRequests = networkRequests.filter(r => r.method !== 'GET');
  console.log("7. Non-GET network requests:", JSON.stringify(postRequests, null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

debugDebouncer().catch(console.error);
