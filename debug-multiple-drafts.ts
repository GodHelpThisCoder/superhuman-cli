
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function debugMultipleDrafts() {
  console.log("=== DEBUG: Multiple Draft Detection ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // First, check how many drafts currently exist
  const initialCheck = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "No cfc" };
        const keys = Object.keys(cfc).filter(k => k.startsWith('draft'));
        return {
          draftCount: keys.length,
          draftKeys: keys,
          firstKey: keys.find(k => k.startsWith('draft')),
          lastKey: keys[keys.length - 1]
        };
      })()
    `,
    returnByValue: true
  });

  console.log("1. Initial state:");
  console.log(JSON.stringify(initialCheck.result.value, null, 2));

  // Try opening a compose (the current way)
  console.log("\n2. Clicking compose button...");
  await conn.Runtime.evaluate({
    expression: `document.querySelector('.ThreadListView-compose')?.click()`,
  });
  await new Promise(r => setTimeout(r, 2000));

  // Check again
  const afterOpen = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "No cfc" };
        const keys = Object.keys(cfc).filter(k => k.startsWith('draft'));

        // Get info about each draft
        const drafts = keys.map(key => {
          const ctrl = cfc[key];
          const draft = ctrl?.state?.draft;
          return {
            key,
            subject: draft?.subject || "(empty)",
            to: (draft?.to || []).map(r => r.email),
            body: (draft?.body || "").substring(0, 30)
          };
        });

        return {
          draftCount: keys.length,
          draftKeys: keys,
          firstKey: keys.find(k => k.startsWith('draft')),
          lastKey: keys[keys.length - 1],
          drafts
        };
      })()
    `,
    returnByValue: true
  });

  console.log("3. After clicking compose:");
  console.log(JSON.stringify(afterOpen.result.value, null, 2));

  // The current getDraftKey function
  const currentMethod = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return null;
        const keys = Object.keys(cfc);
        return keys.find(k => k.startsWith('draft')) || null;
      })()
    `,
    returnByValue: true
  });

  console.log("\n4. Current getDraftKey returns:", currentMethod.result.value);
  console.log("   (Should be the LAST one if we just opened it)");

  await disconnect(conn);
}

debugMultipleDrafts().catch(console.error);
