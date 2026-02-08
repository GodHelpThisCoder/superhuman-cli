
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugPresenterSave() {
  console.log("=== Examining Presenter saveDraft ===\n");

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
      hasPostData: !!params.request.postData
    });
  });

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  await addRecipient(conn, "presenter-test@test.com", undefined, draftKey!);
  await setSubject(conn, "Presenter Save Test", draftKey!);
  await setBody(conn, textToHtml("Presenter save test body"), draftKey!);
  console.log("2. Populated draft");
  allRequests = [];

  // Get presenter and try calling saveDraft directly
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];

        const draft = ctrl.state.draft;
        const props = ctrl.props;
        const account = props.account;

        // Get the presenter like saveDraft does
        const presenter = account.threads.getPresenter(ctrl.state.draftOp, draft.threadId);

        // Check presenter
        const presenterType = presenter?.constructor?.name;
        const presenterMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(presenter || {})).filter(n =>
          n.toLowerCase().includes('save') ||
          n.toLowerCase().includes('draft')
        );

        // Get saveDraft source
        const presenterSaveDraftSource = presenter?.saveDraft?.toString?.().substring(0, 1000);

        // Make sure draft is dirty
        const isDirty = draft?.isDirty?.();

        // Try calling presenter.saveDraft directly
        let saveResult = null;
        let saveError = null;
        try {
          saveResult = await presenter.saveDraft(draft, { saveAttachments: false, updateOutputs: false });
        } catch (e) {
          saveError = e.message;
        }

        return {
          presenterType,
          presenterMethods,
          isDirty,
          saveResult: saveResult === undefined ? "undefined" : saveResult,
          saveError,
          presenterSaveDraftSource
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("\n3. Presenter analysis:");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Wait for network
  await new Promise(r => setTimeout(r, 3000));

  console.log("\n4. Network requests after presenter.saveDraft:");
  const mutationRequests = allRequests.filter(r => r.method !== 'GET');
  console.log(`Total: ${allRequests.length}, Non-GET: ${mutationRequests.length}`);
  console.log(JSON.stringify(mutationRequests.slice(0, 5), null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

debugPresenterSave().catch(console.error);
