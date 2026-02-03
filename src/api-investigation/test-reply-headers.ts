#!/usr/bin/env bun
import { connectToSuperhuman, disconnect, openReplyCompose, saveDraft } from "../superhuman-api";
import { listInbox } from "../inbox";

async function test() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Could not connect");
    process.exit(1);
  }

  const { Runtime, Input } = conn;

  // Get a thread from inbox
  const inbox = await listInbox(conn, { limit: 1 });
  if (inbox.length === 0) {
    console.log("No threads in inbox");
    await disconnect(conn);
    return;
  }

  const testThreadId = inbox[0].id;
  console.log(`Test thread: ${testThreadId} - ${inbox[0].subject}`);

  // Set the threadId properly
  await Runtime.evaluate({
    expression: `
      (() => {
        const vs = window.ViewState;
        vs.tree.set(['threadListView', 'threadId'], ${JSON.stringify(testThreadId)});
        vs.tree.set(['threadPane', 'threadId'], ${JSON.stringify(testThreadId)});
        return true;
      })()
    `,
    returnByValue: true,
  });

  // Open reply compose
  console.log("\nOpening reply compose...");
  const draftKey = await openReplyCompose(conn);
  console.log("Draft key:", draftKey);

  // Save the draft
  console.log("Saving draft...");
  await saveDraft(conn);
  await new Promise(r => setTimeout(r, 1000));

  // Get the full draft data
  const draftInfo = await Runtime.evaluate({
    expression: `
      (() => {
        const tree = window.ViewState?.tree?.get?.() || window.ViewState?.tree?._data;
        const draft = tree?.poppedOutDraft;

        // Get all keys on the draft
        const draftKeys = draft ? Object.keys(draft) : [];

        // Get the draft from GoogleAccount.drafts
        const ga = window.GoogleAccount;
        const draftsStore = ga?.drafts;
        let fullDraft = null;
        if (draftsStore?.identityMap && ${JSON.stringify(draftKey)}) {
          const draftObj = draftsStore.identityMap.get(${JSON.stringify(draftKey)});
          if (draftObj) {
            const model = draftObj._draftModel || draftObj;
            fullDraft = {
              id: model.id,
              threadId: model.threadId,
              inReplyTo: model.inReplyTo,
              references: model.references,
              subject: model.subject,
              messageId: model.messageId,
              headers: model.headers,
              rawJson: model.rawJson,
              modelKeys: Object.keys(model).filter(k => !k.startsWith('_')).slice(0, 30)
            };
          }
        }

        // Also check the thread to see original message headers
        const threadsStore = ga?.threads;
        let originalMessage = null;
        if (threadsStore?.identityMap) {
          const threadObj = threadsStore.identityMap.get(${JSON.stringify(testThreadId)});
          if (threadObj?._threadModel?.messages?.length > 0) {
            const lastMsg = threadObj._threadModel.messages[threadObj._threadModel.messages.length - 1];
            originalMessage = {
              id: lastMsg.id,
              messageId: lastMsg.messageId || lastMsg.rawJson?.messageId,
              subject: lastMsg.subject,
              inReplyTo: lastMsg.inReplyTo || lastMsg.rawJson?.inReplyTo,
              references: lastMsg.references || lastMsg.rawJson?.references
            };
          }
        }

        return {
          poppedOutDraftKeys: draftKeys,
          fullDraft,
          originalMessage
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("\nDraft info:");
  console.log(JSON.stringify(draftInfo.result.value, null, 2));

  // Close the compose
  await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });

  await disconnect(conn);
}

test().catch(console.error);
