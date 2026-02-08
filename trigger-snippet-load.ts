import { connectToSuperhuman, disconnect, openCompose, closeCompose } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  console.log("Checking snippets before triggering...\n");

  let beforeResult = await conn.Runtime.evaluate({
    expression: `window.ViewState?.account?.settings?.get?.('snippets')`,
    returnByValue: true,
  });
  console.log("Before:", JSON.stringify(beforeResult.result.value, null, 2));

  // Open compose and trigger snippet picker
  console.log("\nOpening compose and triggering g ; ...");
  const draftKey = await openCompose(conn);

  // Wait a moment
  await new Promise(r => setTimeout(r, 500));

  // Press g
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: "g", code: "KeyG", text: "g" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: "g", code: "KeyG" });
  await new Promise(r => setTimeout(r, 100));

  // Press ;
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: ";", code: "Semicolon", text: ";" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: ";", code: "Semicolon" });

  // Wait for snippet picker to load
  await new Promise(r => setTimeout(r, 2000));

  console.log("Checking snippets after triggering...\n");

  let afterResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const account = window.ViewState?.account;
        const settings = account?.settings;
        const snippets = settings?.get?.('snippets');

        // Also check for snippet picker state
        const vs = window.ViewState;
        const snippetPicker = vs?._snippetPicker || vs?.snippetPicker;

        // Check compose controller for snippet data
        const cfc = vs?._composeFormController;
        const draftKey = cfc ? Object.keys(cfc)[0] : null;
        const ctrl = draftKey ? cfc[draftKey] : null;

        // Look for snippets in controller props
        let ctrlSnippets = null;
        if (ctrl?.props?.snippets) {
          ctrlSnippets = {
            count: Object.keys(ctrl.props.snippets).length,
            names: Object.values(ctrl.props.snippets).map(s => s.shortcut || s.name)
          };
        }

        // Check if snippets are in a different property
        let foundSnippets = null;
        if (ctrl) {
          const ctrlKeys = Object.keys(ctrl);
          const snippetKeys = ctrlKeys.filter(k => k.toLowerCase().includes('snippet'));
          if (snippetKeys.length > 0) {
            foundSnippets = snippetKeys.map(k => ({
              key: k,
              type: typeof ctrl[k],
              preview: JSON.stringify(ctrl[k])?.slice(0, 200)
            }));
          }
        }

        return {
          email: account?.emailAddress,
          snippetsFromSettings: snippets,
          snippetPickerExists: !!snippetPicker,
          ctrlSnippets,
          foundSnippets
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("After:", JSON.stringify(afterResult.result.value, null, 2));

  // Press Escape to close picker
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });

  // Close compose
  if (draftKey) {
    await closeCompose(conn, draftKey);
  }

  await disconnect(conn);
}

main().catch(console.error);
