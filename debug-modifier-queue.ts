
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugModifierQueue() {
  console.log("=== Examining ModifierQueue ===\n");

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
      url: params.request.url,
      method: params.request.method,
      postData: params.request.postData?.substring(0, 500)
    });
  });

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  await addRecipient(conn, "queue-test@test.com", undefined, draftKey!);
  await setSubject(conn, "Queue Test", draftKey!);
  await setBody(conn, textToHtml("Queue test body"), draftKey!);
  console.log("2. Populated draft");
  allRequests = [];

  // Check modifier queue state
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

        const modifierQueue = presenter.modifierQueue;

        // Check queue state
        const queueState = {
          type: modifierQueue?.constructor?.name,
          methods: Object.getOwnPropertyNames(Object.getPrototypeOf(modifierQueue || {})),
          _queue: modifierQueue?._queue?.length,
          _running: modifierQueue?._running,
          _isPaused: modifierQueue?._isPaused,
          _isStopped: modifierQueue?._isStopped,
        };

        // Check enqueueAsync
        const enqueueAsyncSource = modifierQueue?.enqueueAsync?.toString?.().substring(0, 1000);

        // Try to manually trigger a modifier
        let manualResult = null;
        try {
          // Create a SaveDraft modifier directly
          const modifier = {
            name: 'SaveDraft',
            threadId: draft.threadId,
            persist: async () => {
              console.log('Persist called!');
              return {};
            }
          };

          const result = await modifierQueue.enqueueAsync(modifier);
          manualResult = { success: true, result: result === undefined ? 'undefined' : result };
        } catch (e) {
          manualResult = { error: e.message };
        }

        return {
          queueState,
          enqueueAsyncSource,
          manualResult
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("\n3. ModifierQueue analysis:");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Wait for network
  console.log("\n4. Waiting for network...");
  await new Promise(r => setTimeout(r, 5000));

  console.log("5. All network requests:");
  const draftRelated = allRequests.filter(r =>
    r.url.includes('draft') ||
    r.url.includes('message') ||
    r.url.includes('gmail') ||
    r.url.includes('modify') ||
    r.method !== 'GET'
  );
  console.log(JSON.stringify(draftRelated.slice(0, 10), null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

debugModifierQueue().catch(console.error);
