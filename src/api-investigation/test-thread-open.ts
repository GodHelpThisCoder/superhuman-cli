#!/usr/bin/env bun
import { connectToSuperhuman, disconnect } from "../superhuman-api";
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

  // Check current state
  const before = await Runtime.evaluate({
    expression: `
      (() => {
        const tree = window.ViewState?.tree?.get?.() || window.ViewState?.tree?._data;
        return {
          threadListViewId: tree?.threadListView?.threadId,
          threadPaneId: tree?.threadPane?.threadId,
          isThreadPaneView: window.ViewState?.isThreadPaneView?.()
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("\nBefore:", JSON.stringify(before.result.value, null, 2));

  // Press Enter to open the selected thread (Superhuman's shortcut)
  console.log("\nPressing Enter to open thread...");
  await Input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "Enter", code: "Enter" });
  await new Promise(r => setTimeout(r, 1500));

  // Check state after opening
  const after = await Runtime.evaluate({
    expression: `
      (() => {
        const tree = window.ViewState?.tree?.get?.() || window.ViewState?.tree?._data;
        return {
          threadListViewId: tree?.threadListView?.threadId,
          threadPaneId: tree?.threadPane?.threadId,
          isThreadPaneView: window.ViewState?.isThreadPaneView?.()
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("After Enter:", JSON.stringify(after.result.value, null, 2));

  // Now press 'r' for reply
  console.log("\nPressing 'r' for reply...");
  await Input.dispatchKeyEvent({ type: "keyDown", key: "r", code: "KeyR" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "r", code: "KeyR" });
  await new Promise(r => setTimeout(r, 1500));

  // Check if compose is open
  const compose = await Runtime.evaluate({
    expression: `
      (() => {
        const tree = window.ViewState?.tree?.get?.() || window.ViewState?.tree?._data;
        const draft = tree?.poppedOutDraft;
        return {
          hasCompose: !!draft,
          draftThreadId: draft?.threadId,
          draftInReplyTo: draft?.inReplyTo,
          draftReferences: draft?.references?.slice(0, 2),
          draftSubject: draft?.subject
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("After 'r':", JSON.stringify(compose.result.value, null, 2));

  // Press Escape to close compose
  await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });
  await new Promise(r => setTimeout(r, 500));

  // Press Escape again to close thread pane
  await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });

  await disconnect(conn);
}

test().catch(console.error);
