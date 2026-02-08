import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  console.log("Ensuring we're in inbox (pressing Escape twice)...\n");

  // Press Escape twice to close any dialogs/compose
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });
  await new Promise(r => setTimeout(r, 300));
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });
  await new Promise(r => setTimeout(r, 500));

  console.log("Checking snippets before...");
  let beforeResult = await conn.Runtime.evaluate({
    expression: `window.ViewState?.account?.settings?.get?.('snippets')`,
    returnByValue: true,
  });
  console.log("Before:", JSON.stringify(beforeResult.result.value, null, 2));

  console.log("\nPressing g ; from inbox...");

  // Press g
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: "g", code: "KeyG", text: "g" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: "g", code: "KeyG" });
  await new Promise(r => setTimeout(r, 200));

  // Press ;
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: ";", code: "Semicolon", text: ";" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: "Semicolon", code: "Semicolon" });

  // Wait for snippet picker to appear and load
  console.log("Waiting for snippet picker...");
  await new Promise(r => setTimeout(r, 3000));

  console.log("\nChecking snippets after triggering...");
  let afterResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const account = window.ViewState?.account;
        const settings = account?.settings;
        const snippets = settings?.get?.('snippets');
        const cacheSnippets = settings?._cache?.snippets;

        // Check ViewState for any snippet-related state
        const vs = window.ViewState;
        const vsKeys = Object.keys(vs || {});
        const snippetKeys = vsKeys.filter(k => k.toLowerCase().includes('snippet'));

        // Check for popup/modal with snippets
        let popupSnippets = null;
        for (const key of snippetKeys) {
          const val = vs[key];
          if (val && typeof val === 'object') {
            popupSnippets = {
              key,
              type: val.constructor?.name,
              keys: Object.keys(val).slice(0, 20)
            };
          }
        }

        return {
          email: account?.emailAddress,
          snippetsFromGet: snippets,
          snippetsFromCache: cacheSnippets,
          snippetCount: Object.keys(snippets || {}).length,
          cacheCount: Object.keys(cacheSnippets || {}).length,
          vsSnippetKeys: snippetKeys,
          popupSnippets
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("After:", JSON.stringify(afterResult.result.value, null, 2));

  // Press Escape to close
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });

  await disconnect(conn);
}

main().catch(console.error);
