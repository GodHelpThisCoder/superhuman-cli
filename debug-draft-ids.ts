
import { connectToSuperhuman, disconnect, openCompose, getDraftState, setSubject, addRecipient, setBody, saveDraft, textToHtml } from "./src/superhuman-api";

async function debugDraftIds() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  console.log("=== DEBUG: Draft ID vs Draft Key ===\n");

  // Step 1: Open compose and get the draftKey
  console.log("1. Opening compose...");
  const draftKey = await openCompose(conn);
  console.log(`   draftKey (from openCompose): "${draftKey}"`);

  // Step 2: Get draft state and see what ID it returns
  console.log("\n2. Getting draft state...");
  const state = await getDraftState(conn);
  console.log(`   state.id (from getDraftState): "${state?.id}"`);
  console.log(`   Are they the same? ${draftKey === state?.id}`);

  // Step 3: Look at what's actually in _composeFormController
  const inspectResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "No cfc" };

        const keys = Object.keys(cfc);
        const drafts = {};

        for (const key of keys) {
          if (key.startsWith('draft')) {
            const ctrl = cfc[key];
            const draft = ctrl?.state?.draft;
            drafts[key] = {
              controllerKey: key,
              draftId: draft?.id,
              subject: draft?.subject,
              body: (draft?.body || "").substring(0, 50),
              to: (draft?.to || []).map(r => r.email)
            };
          }
        }

        return { allKeys: keys, drafts };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n3. Inspecting _composeFormController:");
  console.log(JSON.stringify(inspectResult.result.value, null, 2));

  // Step 4: Try setting values using draftKey
  console.log("\n4. Setting subject using draftKey...");
  const subjectSet = await setSubject(conn, "Test Subject via draftKey", draftKey!);
  console.log(`   setSubject returned: ${subjectSet}`);

  // Step 5: Try setting values using state.id
  console.log("\n5. Setting body using state.id...");
  const bodySet = await setBody(conn, textToHtml("Test body via state.id"), state?.id);
  console.log(`   setBody returned: ${bodySet}`);

  // Step 6: Read state again
  console.log("\n6. Reading draft state after modifications...");
  const stateAfter = await getDraftState(conn);
  console.log(`   subject: "${stateAfter?.subject}"`);
  console.log(`   body: "${stateAfter?.body}"`);
  console.log(`   to: ${JSON.stringify(stateAfter?.to)}`);

  // Step 7: Check what withDraftController actually finds
  const lookupTest = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "No cfc" };

        const draftKey = ${JSON.stringify(draftKey)};
        const stateId = ${JSON.stringify(state?.id)};

        const ctrlByKey = cfc[draftKey];
        const ctrlById = cfc[stateId];

        return {
          draftKey,
          stateId,
          foundByKey: !!ctrlByKey,
          foundById: !!ctrlById,
          allKeys: Object.keys(cfc).filter(k => k.startsWith('draft'))
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n7. Testing which ID finds the controller:");
  console.log(JSON.stringify(lookupTest.result.value, null, 2));

  await disconnect(conn);
}

debugDraftIds().catch(console.error);
