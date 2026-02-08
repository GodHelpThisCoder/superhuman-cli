
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugActualNetworkSave() {
  console.log("=== Finding What Triggers Actual Network Save ===\n");

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
      method: params.request.method,
      postData: params.request.postData?.substring(0, 300)
    });
  });

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  // Populate the draft
  await addRecipient(conn, "network-save@test.com", undefined, draftKey!);
  await setSubject(conn, "Network Save Test", draftKey!);
  await setBody(conn, textToHtml("Network save test body"), draftKey!);
  console.log("2. Populated draft");

  // Check what other save-related methods exist
  const methods = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        const ctrlProto = Object.getPrototypeOf(ctrl);
        const ctrlClass = ctrl.constructor;

        // Instance methods
        const instanceMethods = Object.getOwnPropertyNames(ctrlProto).filter(n =>
          n.toLowerCase().includes('save') ||
          n.toLowerCase().includes('sync') ||
          n.toLowerCase().includes('send') ||
          n.toLowerCase().includes('submit') ||
          n.toLowerCase().includes('persist') ||
          n.toLowerCase().includes('create') ||
          n.toLowerCase().includes('upload')
        );

        // Static methods
        const staticMethods = Object.getOwnPropertyNames(ctrlClass).filter(n =>
          typeof ctrlClass[n] === 'function' && (
            n.toLowerCase().includes('save') ||
            n.toLowerCase().includes('sync') ||
            n.toLowerCase().includes('send') ||
            n.toLowerCase().includes('submit') ||
            n.toLowerCase().includes('persist') ||
            n.toLowerCase().includes('create')
          )
        );

        return {
          instanceMethods,
          staticMethods
        };
      })()
    `,
    returnByValue: true
  });

  console.log("3. Available methods:");
  console.log(JSON.stringify(methods.result.value, null, 2));

  // Try calling the static saveDraft directly
  console.log("\n4. Attempting direct static saveDraft call...");
  networkRequests = [];

  const saveResult = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        const ctrlClass = ctrl.constructor;

        // Get necessary props
        const draft = ctrl.state.draft;
        const draftOp = ctrl.state.draftOp;
        const props = ctrl.props;

        // Check changesAllowed first
        const changesAllowed = ctrlClass.changesAllowed(props, ctrl.state);

        if (!changesAllowed) {
          return { error: "changesAllowed returned false" };
        }

        // Try calling static saveDraft directly
        try {
          const result = await ctrlClass.saveDraft(draftOp, draft, props, { saveSource: 'cli-debug' });
          return { success: true, result: result === undefined ? "undefined" : result };
        } catch (e) {
          return { error: e.message, stack: e.stack?.substring(0, 500) };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("5. Direct saveDraft result:", JSON.stringify(saveResult.result.value, null, 2));

  // Wait for network
  await new Promise(r => setTimeout(r, 3000));

  console.log("\n6. Network requests after direct save:");
  const postRequests = networkRequests.filter(r => ['POST', 'PUT', 'PATCH'].includes(r.method));
  console.log(JSON.stringify(postRequests.slice(0, 5), null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

debugActualNetworkSave().catch(console.error);
