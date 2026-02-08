import { connectToSuperhuman, disconnect, openCompose, setSubject, setBody, addRecipient } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const { Runtime, Network } = conn;

  // Enable network monitoring to capture what happens on save
  await Network.enable();

  const requests: any[] = [];
  Network.requestWillBeSent((params) => {
    if (params.request.url.includes('superhuman') ||
        params.request.url.includes('gmail') ||
        params.request.url.includes('graph.microsoft')) {
      requests.push({
        url: params.request.url,
        method: params.request.method,
        postData: params.request.postData?.substring(0, 500)
      });
    }
  });

  console.log("Opening compose and setting content...");
  const draftKey = await openCompose(conn);
  await addRecipient(conn, "test@example.com", undefined, draftKey);
  await setSubject(conn, "Test draft sync investigation", draftKey);
  await setBody(conn, "<p>Testing how drafts are saved</p>", draftKey);

  console.log("Waiting for autosave...");
  await new Promise(r => setTimeout(r, 5000)); // Wait for autosave

  // Check disk/sync and disk/modifier
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const disk = di.get('disk');

        const findings = {};

        // Check disk/sync service
        if (disk.sync) {
          findings.sync = {
            type: typeof disk.sync,
            methods: Object.keys(disk.sync).filter(k => typeof disk.sync[k] === 'function').slice(0, 30),
            properties: Object.keys(disk.sync).filter(k => typeof disk.sync[k] !== 'function').slice(0, 20)
          };
        }

        // Check disk/modifier service
        if (disk.modifier) {
          findings.modifier = {
            type: typeof disk.modifier,
            methods: Object.keys(disk.modifier).filter(k => typeof disk.modifier[k] === 'function').slice(0, 30),
          };
        }

        // Check if there's a draftOp or similar
        const op = di.get('op');
        if (op) {
          const opMethods = Object.keys(op).filter(k => typeof op[k] === 'function');
          findings.opDraftMethods = opMethods.filter(m => m.toLowerCase().includes('draft'));
          findings.opSaveMethods = opMethods.filter(m => m.toLowerCase().includes('save') || m.toLowerCase().includes('create'));
        }

        // Check compose controller's save mechanism
        const cfc = window.ViewState?._composeFormController;
        if (cfc) {
          const keys = Object.keys(cfc);
          if (keys.length > 0) {
            const ctrl = cfc[keys[0]];

            // Try to understand what _saveDraftAsync calls
            const proto = Object.getPrototypeOf(ctrl);
            findings.protoMethods = Object.getOwnPropertyNames(proto)
              .filter(k => k.includes('save') || k.includes('draft') || k.includes('Draft'))
              .slice(0, 20);

            // Check state
            findings.stateKeys = ctrl.state ? Object.keys(ctrl.state).slice(0, 20) : [];
          }
        }

        return findings;
      })()
    `,
    returnByValue: true,
  });

  console.log("Sync investigation:", JSON.stringify(result.result.value, null, 2));
  console.log("\nNetwork requests captured:", JSON.stringify(requests, null, 2));

  // Close compose
  const { Input } = conn;
  await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });

  await disconnect(conn);
}

main().catch(console.error);
