
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugEnqueueModifier() {
  console.log("=== Examining enqueueModifier ===\n");

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
      url: params.request.url.substring(0, 150),
      method: params.request.method,
      postData: params.request.postData?.substring(0, 200)
    });
  });

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  await addRecipient(conn, "modifier-test@test.com", undefined, draftKey!);
  await setSubject(conn, "Modifier Test", draftKey!);
  await setBody(conn, textToHtml("Modifier test body"), draftKey!);
  console.log("2. Populated draft");
  allRequests = [];

  // Examine enqueueModifier
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

        // Check enqueueModifier
        const enqueueModifierSource = presenter?.enqueueModifier?.toString?.().substring(0, 1000);

        // Check what saveDraft modifier does
        // First find the Jn.a.saveDraft (or equivalent) class
        const modifiers = presenter?.modifiers;
        const modifierQueue = presenter?._modifierQueue;
        const pendingModifiers = presenter?._pendingModifiers;

        // Try to trace what happens when we call saveDraft
        let traceResult = null;
        try {
          // Override enqueueModifier temporarily to see what modifier is created
          const originalEnqueue = presenter.enqueueModifier.bind(presenter);
          let capturedModifier = null;

          presenter.enqueueModifier = function(modifier, updateOutputs) {
            capturedModifier = {
              type: modifier?.constructor?.name,
              keys: Object.keys(modifier || {}),
              updateOutputs
            };
            return originalEnqueue(modifier, updateOutputs);
          };

          await presenter.saveDraft(draft, { saveAttachments: false, updateOutputs: false });

          // Restore
          presenter.enqueueModifier = originalEnqueue;

          traceResult = capturedModifier;
        } catch (e) {
          traceResult = { error: e.message };
        }

        return {
          enqueueModifierSource,
          modifiersCount: modifiers?.length,
          modifierQueueCount: modifierQueue?.length,
          pendingModifiersCount: pendingModifiers?.length,
          traceResult
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("\n3. enqueueModifier analysis:");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Wait for network
  await new Promise(r => setTimeout(r, 3000));

  console.log("\n4. All network requests:");
  console.log(JSON.stringify(allRequests, null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

debugEnqueueModifier().catch(console.error);
