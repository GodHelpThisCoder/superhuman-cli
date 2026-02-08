
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugActualSave() {
  console.log("=== Understanding the Actual Save Mechanism ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Enable network monitoring
  await conn.Network.enable();

  const allRequests: any[] = [];
  conn.Network.requestWillBeSent((params) => {
    allRequests.push({
      url: params.request.url,
      method: params.request.method,
      postData: params.request.postData?.substring(0, 200)
    });
  });

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  await addRecipient(conn, "actual-test@test.com", undefined, draftKey!);
  await setSubject(conn, "Actual Save Test", draftKey!);
  await setBody(conn, textToHtml("Actual save test body"), draftKey!);
  console.log("2. Set content");

  // Check the debouncer and try to call save directly
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];

        if (!ctrl) return { error: "No controller" };

        // Check debouncer state
        const debouncer = ctrl._debouncer;
        const debouncerKeys = debouncer ? Object.keys(debouncer) : [];

        // Try to access the static saveDraft method from the prototype/class
        const ctrlProto = Object.getPrototypeOf(ctrl);
        const ctrlConstructor = ctrl.constructor;
        const hasStaticSaveDraft = typeof ctrlConstructor.saveDraft === 'function';

        // Check what props we're working with
        const props = ctrl.props;
        const state = ctrl.state;

        // Try to see if there's a direct saveDraft call
        let staticSaveSource = null;
        if (hasStaticSaveDraft) {
          staticSaveSource = ctrlConstructor.saveDraft.toString().substring(0, 600);
        }

        // Check what draftOp is
        const draftOp = state?.draftOp;

        // Try triggering the debouncer flush manually
        let flushResult = null;
        try {
          if (debouncer?.flush) {
            await debouncer.flush();
            flushResult = "flush called";
          } else if (debouncer?._flush) {
            await debouncer._flush();
            flushResult = "_flush called";
          } else {
            flushResult = "no flush method found";
          }
        } catch (e) {
          flushResult = "error: " + e.message;
        }

        return {
          debouncerKeys,
          hasStaticSaveDraft,
          staticSaveSource,
          draftOp: draftOp ? typeof draftOp : 'undefined',
          flushResult
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("3. Save mechanism analysis:");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Wait longer for network
  console.log("\n4. Waiting 5 seconds for any network activity...");
  await new Promise(r => setTimeout(r, 5000));

  console.log("5. All network requests:");
  const relevantRequests = allRequests.filter(r =>
    r.url.includes('draft') ||
    r.url.includes('message') ||
    r.url.includes('save') ||
    r.url.includes('gmail') ||
    r.method === 'POST' ||
    r.method === 'PUT' ||
    r.method === 'PATCH'
  );
  console.log(JSON.stringify(relevantRequests, null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

debugActualSave().catch(console.error);
