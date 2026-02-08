
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugForcePersist() {
  console.log("=== Finding Ways to Force Persist ===\n");

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
      postData: params.request.postData?.substring(0, 300)
    });
  });

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  await addRecipient(conn, "force-persist@test.com", undefined, draftKey!);
  await setSubject(conn, "Force Persist Test", draftKey!);
  await setBody(conn, textToHtml("Force persist test body"), draftKey!);
  console.log("2. Populated draft");
  allRequests = [];

  // Try different approaches to force persistence
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

        const attempts = [];

        // Approach 1: Try createOrReplaceDraftAsync
        try {
          const result = await presenter.createOrReplaceDraftAsync?.(draft);
          attempts.push({ method: 'createOrReplaceDraftAsync', success: true, result: String(result).substring(0, 100) });
        } catch (e) {
          attempts.push({ method: 'createOrReplaceDraftAsync', error: e.message });
        }

        // Approach 2: Check if there's a sync method on account
        if (account.sync) {
          try {
            await account.sync();
            attempts.push({ method: 'account.sync', success: true });
          } catch (e) {
            attempts.push({ method: 'account.sync', error: e.message });
          }
        }

        // Approach 3: Check the di for a sync service
        try {
          const syncService = account.di?.get?.('syncService');
          if (syncService?.flush) {
            await syncService.flush();
            attempts.push({ method: 'syncService.flush', success: true });
          }
        } catch (e) {
          attempts.push({ method: 'syncService', error: e.message });
        }

        // Approach 4: Try using the Gmail API directly
        try {
          const gmail = account.di?.get?.('gmail');
          const gmailMethods = gmail ? Object.getOwnPropertyNames(Object.getPrototypeOf(gmail)).filter(n =>
            n.includes('draft') || n.includes('Draft') || n.includes('create') || n.includes('save')
          ) : [];
          attempts.push({ method: 'gmail methods', methods: gmailMethods });
        } catch (e) {
          attempts.push({ method: 'gmail lookup', error: e.message });
        }

        // Approach 5: Try flushing the modifier queue
        try {
          const modifierQueue = presenter.modifierQueue;
          const pending = modifierQueue?.getPendingLength?.();
          const hasModifiers = modifierQueue?.hasModifiers?.();
          attempts.push({
            method: 'modifierQueue state',
            pending,
            hasModifiers,
            queueMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(modifierQueue || {}))
          });
        } catch (e) {
          attempts.push({ method: 'modifierQueue check', error: e.message });
        }

        return attempts;
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("\n3. Persistence attempts:");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Wait for network
  console.log("\n4. Waiting for network...");
  await new Promise(r => setTimeout(r, 5000));

  console.log("5. Network requests:");
  const draftRelated = allRequests.filter(r =>
    r.method !== 'GET' || r.url.includes('draft')
  );
  console.log(JSON.stringify(draftRelated.slice(0, 10), null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

debugForcePersist().catch(console.error);
