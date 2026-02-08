
import { connectToSuperhuman, disconnect, openCompose, getDraftState, setSubject, addRecipient, setBody, saveDraft, textToHtml, closeCompose } from "./src/superhuman-api";

async function debugDraftSave() {
  console.log("=== DEBUG: Draft Save Persistence ===\n");

  // Phase 1: Create and populate draft (mimicking cmdCompose)
  console.log("PHASE 1: Creating draft...");
  const conn1 = await connectToSuperhuman(9333, true);
  if (!conn1) {
    console.error("Failed to connect (phase 1)");
    return;
  }

  const draftKey = await openCompose(conn1);
  console.log(`1. Opened compose, draftKey: "${draftKey}"`);

  // Add recipient
  const addedTo = await addRecipient(conn1, "test@example.com", undefined, draftKey!);
  console.log(`2. addRecipient returned: ${addedTo}`);

  // Set subject
  const setSubj = await setSubject(conn1, "Debug Test Subject", draftKey!);
  console.log(`3. setSubject returned: ${setSubj}`);

  // Set body
  const setB = await setBody(conn1, textToHtml("Debug test body content"), draftKey!);
  console.log(`4. setBody returned: ${setB}`);

  // Get state (this is what cmdCompose returns)
  const state = await getDraftState(conn1);
  console.log(`5. getDraftState returned:`);
  console.log(`   id: "${state?.id}"`);
  console.log(`   subject: "${state?.subject}"`);
  console.log(`   body: "${state?.body?.substring(0, 50)}..."`);
  console.log(`   to: ${JSON.stringify(state?.to)}`);

  // Disconnect (cmdCompose does this)
  await disconnect(conn1);
  console.log("6. Disconnected from conn1");

  // Phase 2: Reconnect and save (mimicking cmdDraft)
  console.log("\nPHASE 2: Reconnecting and saving...");
  const conn2 = await connectToSuperhuman(9333, true);
  if (!conn2) {
    console.error("Failed to connect (phase 2)");
    return;
  }

  // Check what state looks like after reconnection
  const stateAfterReconnect = await getDraftState(conn2);
  console.log(`7. getDraftState after reconnect:`);
  console.log(`   id: "${stateAfterReconnect?.id}"`);
  console.log(`   subject: "${stateAfterReconnect?.subject}"`);
  console.log(`   body: "${stateAfterReconnect?.body?.substring(0, 50)}..."`);
  console.log(`   to: ${JSON.stringify(stateAfterReconnect?.to)}`);

  // This is what cmdDraft does: save with state.id
  console.log(`\n8. Calling saveDraft with state.id: "${state?.id}"`);
  const saved = await saveDraft(conn2, state?.id);
  console.log(`   saveDraft returned: ${saved}`);

  // Check state after save
  const stateAfterSave = await getDraftState(conn2);
  console.log(`9. getDraftState after save:`);
  console.log(`   id: "${stateAfterSave?.id}"`);
  console.log(`   subject: "${stateAfterSave?.subject}"`);
  console.log(`   body: "${stateAfterSave?.body?.substring(0, 50)}..."`);
  console.log(`   to: ${JSON.stringify(stateAfterSave?.to)}`);

  await disconnect(conn2);
  console.log("\n10. Done");
}

debugDraftSave().catch(console.error);
