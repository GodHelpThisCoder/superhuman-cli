
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugDraftOp() {
  console.log("=== Understanding draftOp ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Enable network monitoring
  await conn.Network.enable();

  let networkRequests: any[] = [];
  conn.Network.requestWillBeSent((params) => {
    if (params.request.method !== 'GET') {
      networkRequests.push({
        time: Date.now(),
        url: params.request.url.substring(0, 100),
        method: params.request.method,
        postData: params.request.postData?.substring(0, 200)
      });
    }
  });

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  // Populate the draft
  await addRecipient(conn, "op-test@test.com", undefined, draftKey!);
  await setSubject(conn, "DraftOp Test", draftKey!);
  await setBody(conn, textToHtml("DraftOp test body"), draftKey!);
  console.log("2. Populated draft");

  // Check draftOp
  const draftOpAnalysis = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];

        const draftOp = ctrl.state?.draftOp;

        if (!draftOp) return { error: "No draftOp" };

        // What is draftOp?
        const draftOpType = typeof draftOp;
        const draftOpConstructor = draftOp.constructor?.name;
        const draftOpKeys = Object.keys(draftOp);

        // Check if it has methods
        const draftOpProtoMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(draftOp));

        // Check common async patterns
        const hasStart = typeof draftOp.start === 'function';
        const hasExecute = typeof draftOp.execute === 'function';
        const hasRun = typeof draftOp.run === 'function';
        const hasSave = typeof draftOp.save === 'function';

        return {
          draftOpType,
          draftOpConstructor,
          draftOpKeys,
          draftOpProtoMethods,
          hasStart,
          hasExecute,
          hasRun,
          hasSave
        };
      })()
    `,
    returnByValue: true
  });

  console.log("3. draftOp analysis:");
  console.log(JSON.stringify(draftOpAnalysis.result.value, null, 2));

  // Try using run method if it exists
  if (draftOpAnalysis.result.value.hasRun) {
    console.log("\n4. Trying draftOp.run()...");
    networkRequests = [];

    const runResult = await conn.Runtime.evaluate({
      expression: `
        (async () => {
          const cfc = window.ViewState?._composeFormController;
          const draftKey = ${JSON.stringify(draftKey)};
          const ctrl = cfc[draftKey];
          const draftOp = ctrl.state?.draftOp;

          try {
            const result = await draftOp.run?.(() => {
              return { type: 'save', draft: ctrl.state.draft };
            });
            return { success: true, result: result === undefined ? "undefined" : result };
          } catch (e) {
            return { error: e.message };
          }
        })()
      `,
      returnByValue: true,
      awaitPromise: true
    });

    console.log("5. run() result:", JSON.stringify(runResult.result.value, null, 2));

    await new Promise(r => setTimeout(r, 2000));
    console.log("6. Network after run:", JSON.stringify(networkRequests, null, 2));
  }

  await conn.Network.disable();
  await disconnect(conn);
}

debugDraftOp().catch(console.error);
