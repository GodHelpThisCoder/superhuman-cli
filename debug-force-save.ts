
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugForceSave() {
  console.log("=== Testing _forceSaveDraftWithBody ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Enable network monitoring
  await conn.Network.enable();

  const requests: any[] = [];
  conn.Network.requestWillBeSent((params) => {
    if (params.request.url.includes('draft') || params.request.url.includes('gmail') || params.request.url.includes('messages')) {
      requests.push({
        url: params.request.url,
        method: params.request.method,
        postData: params.request.postData?.substring(0, 500)
      });
    }
  });

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  await addRecipient(conn, "force-test@test.com", undefined, draftKey!);
  await setSubject(conn, "Force Save Test", draftKey!);
  await setBody(conn, textToHtml("Force save test body"), draftKey!);
  console.log("2. Set content");

  // Try the _forceSaveDraftWithBody method
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];

        if (!ctrl) return { error: "No controller" };

        // Check what _forceSaveDraftWithBody does
        const forceSaveFnSource = ctrl._forceSaveDraftWithBody?.toString?.()?.substring(0, 800);

        // Check draft state before
        const draft = ctrl.state?.draft;
        const beforeSave = {
          dirty: draft?.dirty,
          subject: draft?.subject,
          body: draft?.body?.substring(0, 50)
        };

        // Try calling _forceSaveDraftWithBody
        let forceResult = null;
        let forceError = null;
        try {
          forceResult = await ctrl._forceSaveDraftWithBody?.();
        } catch (e) {
          forceError = e.message;
        }

        // Check draft state after
        const afterForce = {
          dirty: draft?.dirty,
          subject: draft?.subject,
          body: draft?.body?.substring(0, 50)
        };

        return {
          forceSaveFnSource,
          beforeSave,
          forceResult: forceResult === undefined ? "undefined" : forceResult,
          forceError,
          afterForce
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("3. Force save analysis:");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Wait for network
  await new Promise(r => setTimeout(r, 3000));

  console.log("\n4. Network requests:");
  console.log(JSON.stringify(requests, null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

debugForceSave().catch(console.error);
