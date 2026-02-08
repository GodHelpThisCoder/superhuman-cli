
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, textToHtml } from "./src/superhuman-api";

async function debugStaticSaveDraft() {
  console.log("=== Examining Static saveDraft Method ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  await addRecipient(conn, "static-test@test.com", undefined, draftKey!);
  await setSubject(conn, "Static SaveDraft Test", draftKey!);
  await setBody(conn, textToHtml("Static saveDraft test body"), draftKey!);
  console.log("2. Populated draft");

  // Get full saveDraft source
  const sourceResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        const ctrlClass = ctrl.constructor;

        // Get the full source
        return ctrlClass.saveDraft?.toString?.();
      })()
    `,
    returnByValue: true
  });

  console.log("\n3. Full saveDraft source:");
  console.log(sourceResult.result.value);

  // Check what props.account and related things look like
  const propsCheck = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];

        const props = ctrl.props;
        const state = ctrl.state;
        const draft = state.draft;

        // Check the condition for actual saving
        const isDirty = draft?.isDirty?.();
        const isSnippet = draft?.isSnippet?.();

        // Check account
        const account = props.account;
        const hasThreads = !!account?.threads;
        const hasGmail = !!account?.di?.get?.('gmail');

        return {
          isDirty,
          isSnippet,
          hasAccount: !!account,
          hasThreads,
          hasGmail,
          accountType: account?.constructor?.name,
          propsKeys: Object.keys(props || {}),
        };
      })()
    `,
    returnByValue: true
  });

  console.log("\n4. Props and state check:");
  console.log(JSON.stringify(propsCheck.result.value, null, 2));

  await disconnect(conn);
}

debugStaticSaveDraft().catch(console.error);
