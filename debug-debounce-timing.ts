
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugDebounceTiming() {
  console.log("=== Debounce Timing Analysis ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Enable network monitoring
  await conn.Network.enable();

  let networkRequests: any[] = [];
  conn.Network.requestWillBeSent((params) => {
    const url = params.request.url;
    if (url.includes('draft') || url.includes('message') || url.includes('gmail') || params.request.method === 'POST') {
      networkRequests.push({
        time: Date.now(),
        url: url.substring(0, 100),
        method: params.request.method
      });
    }
  });

  const startTime = Date.now();

  const draftKey = await openCompose(conn);
  console.log(`${Date.now() - startTime}ms: Opened compose: ${draftKey}`);

  await addRecipient(conn, "timing-test@test.com", undefined, draftKey!);
  console.log(`${Date.now() - startTime}ms: Added recipient`);

  await setSubject(conn, "Timing Test Subject", draftKey!);
  console.log(`${Date.now() - startTime}ms: Set subject`);

  await setBody(conn, textToHtml("Timing test body"), draftKey!);
  console.log(`${Date.now() - startTime}ms: Set body`);

  // Now call _saveDraftAsync and watch timing
  const saveResult = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];

        const beforeDirty = ctrl.state?.draft?.dirty;

        // Call save and wait
        const result = await ctrl._saveDraftAsync();

        const afterDirty = ctrl.state?.draft?.dirty;

        return {
          beforeDirty,
          afterDirty,
          result: result === undefined ? "undefined" : result
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log(`${Date.now() - startTime}ms: _saveDraftAsync returned:`, JSON.stringify(saveResult.result.value));

  // Now wait and see if any network requests happen
  console.log("\nWaiting for debounced network activity...");
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    const elapsed = Date.now() - startTime;
    if (networkRequests.length > 0) {
      console.log(`${elapsed}ms: Network requests so far:`, networkRequests.length);
    }
  }

  console.log("\n\nFinal network requests (POST/PUT/PATCH only):");
  const mutationRequests = networkRequests.filter(r => ['POST', 'PUT', 'PATCH'].includes(r.method));
  console.log(JSON.stringify(mutationRequests, null, 2));

  console.log("\nAll network requests:");
  console.log(JSON.stringify(networkRequests, null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

debugDebounceTiming().catch(console.error);
