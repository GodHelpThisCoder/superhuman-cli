#!/usr/bin/env bun
import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function explore() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Could not connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  // Get method signatures
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        const vs = window.ViewState;

        return {
          setThreadId: vs.setThreadId?.toString?.()?.slice(0, 500),
          updateThreadId: vs.updateThreadId?.toString?.()?.slice(0, 500),
          showThreadOrFocusPopout: vs.showThreadOrFocusPopout?.toString?.()?.slice(0, 500),
          showThreadPaneView: vs.showThreadPaneView?.toString?.()?.slice(0, 500),
          getThreadId: vs.getThreadId?.toString?.()?.slice(0, 300),
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("Method signatures:");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Get a thread ID from inbox to test with
  const threadResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const threads = ga?.threads;
        const inbox = threads?.search?.('in:inbox', { limit: 1 });
        const firstThread = inbox?.[0];
        return {
          testThreadId: firstThread?.id,
          testSubject: firstThread?._threadModel?.subject,
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\nTest thread:");
  console.log(JSON.stringify(threadResult.result.value, null, 2));

  const testThreadId = threadResult.result.value?.testThreadId;
  if (!testThreadId) {
    console.log("No thread found to test with");
    await disconnect(conn);
    return;
  }

  // Try using setThreadId to open the thread
  console.log(`\nTrying to open thread: ${testThreadId}`);

  const openResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const vs = window.ViewState;
        const threadId = ${JSON.stringify(testThreadId)};

        // Method 1: Try setThreadId
        if (vs.setThreadId) {
          try {
            vs.setThreadId(threadId);
            await new Promise(r => setTimeout(r, 500));
            const tree = vs.tree?.get?.() || vs.tree?._data;
            return {
              method: 'setThreadId',
              threadPaneId: tree?.threadPane?.threadId,
              success: tree?.threadPane?.threadId === threadId
            };
          } catch (e) {
            // Try next method
          }
        }

        // Method 2: Try showThreadOrFocusPopout
        if (vs.showThreadOrFocusPopout) {
          try {
            vs.showThreadOrFocusPopout(threadId);
            await new Promise(r => setTimeout(r, 500));
            const tree = vs.tree?.get?.() || vs.tree?._data;
            return {
              method: 'showThreadOrFocusPopout',
              threadPaneId: tree?.threadPane?.threadId,
              success: tree?.threadPane?.threadId === threadId
            };
          } catch (e) {
            return { error: e.message };
          }
        }

        return { error: 'No suitable method found' };
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("Open result:");
  console.log(JSON.stringify(openResult.result.value, null, 2));

  await disconnect(conn);
}

explore().catch(console.error);
