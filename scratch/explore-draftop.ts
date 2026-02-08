import { connectToSuperhuman, disconnect, openCompose, setSubject, setBody, addRecipient, saveDraft } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const { Runtime, Network } = conn;

  // Enable network monitoring
  await Network.enable();

  const requests: any[] = [];
  Network.requestWillBeSent((params) => {
    requests.push({
      url: params.request.url,
      method: params.request.method,
      postData: params.request.postData?.substring(0, 1000)
    });
    console.log(`REQUEST: ${params.request.method} ${params.request.url}`);
  });

  console.log("Opening compose and setting content...");
  const draftKey = await openCompose(conn);
  await addRecipient(conn, "test@example.com", undefined, draftKey);
  await setSubject(conn, "Draft sync test " + Date.now(), draftKey);
  await setBody(conn, "<p>Testing draft storage mechanism</p>", draftKey);

  // Check what draftOp looks like before save
  const beforeSave = await Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "No compose" };
        const keys = Object.keys(cfc);
        if (!keys.length) return { error: "No keys" };
        const ctrl = cfc[keys[0]];

        const draftOp = ctrl?.state?.draftOp;
        const draft = ctrl?.state?.draft;

        return {
          hasDraftOp: !!draftOp,
          draftOpType: draftOp?.constructor?.name,
          draftOpKeys: draftOp ? Object.keys(draftOp).slice(0, 20) : [],
          draftId: draft?.id,
          isDirty: draft?.isDirty?.()
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("Before save:", JSON.stringify(beforeSave.result.value, null, 2));

  // Now trigger explicit save
  console.log("\nTriggering explicit save...");
  await saveDraft(conn, draftKey);
  await new Promise(r => setTimeout(r, 3000));

  // Check after save
  const afterSave = await Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "No compose" };
        const keys = Object.keys(cfc);
        if (!keys.length) return { error: "No keys" };
        const ctrl = cfc[keys[0]];

        const draftOp = ctrl?.state?.draftOp;
        const draft = ctrl?.state?.draft;

        // Check what draftOp does
        let draftOpDetails = null;
        if (draftOp) {
          draftOpDetails = {
            type: draftOp.constructor?.name,
            methods: Object.keys(draftOp).filter(k => typeof draftOp[k] === 'function'),
            properties: Object.keys(draftOp).filter(k => typeof draftOp[k] !== 'function')
          };
        }

        return {
          draftOpDetails,
          draftId: draft?.id,
          isDirty: draft?.isDirty?.()
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("After save:", JSON.stringify(afterSave.result.value, null, 2));

  // Check op service for draft operations
  const opService = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const op = ga?.di?.get('op');
        if (!op) return { error: "No op service" };

        // Get all methods
        const methods = Object.keys(op).filter(k => typeof op[k] === 'function');

        // Check for any pending operations
        const pendingOps = [];
        if (op._pendingOps) {
          pendingOps.push(...Object.keys(op._pendingOps));
        }
        if (op._queue) {
          pendingOps.push("has _queue");
        }

        return {
          allMethods: methods,
          pendingOps
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("Op service:", JSON.stringify(opService.result.value, null, 2));

  console.log("\nAll network requests captured:");
  console.log(JSON.stringify(requests.filter(r =>
    r.url.includes('draft') ||
    r.url.includes('message') ||
    r.url.includes('~backend')
  ), null, 2));

  // Close compose
  const { Input } = conn;
  await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });

  await disconnect(conn);
}

main().catch(console.error);
