import { connectToSuperhuman, disconnect, openCompose, closeCompose } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // First, open a compose window
  const draftKey = await openCompose(conn);
  console.log("Opened compose:", draftKey);
  await new Promise(r => setTimeout(r, 500));

  // Now simulate ";" to open snippet autocomplete in compose
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: ";", code: "Semicolon", text: ";" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: ";", code: "Semicolon" });

  // Wait for autocomplete/snippets to load
  await new Promise(r => setTimeout(r, 1000));

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const vs = window.ViewState;
        const cfc = vs?._composeFormController;
        const draftKey = Object.keys(cfc || {})[0];
        const ctrl = cfc?.[draftKey];
        const account = ctrl?.props?.account;
        const threads = account?.threads;
        const onDisk = threads?.onDisk;

        // Check user object in onDisk
        const user = onDisk?.user;
        const userKeys = user ? Object.keys(user) : [];
        const userSnippetKeys = userKeys.filter(k =>
          k.toLowerCase().includes("snippet") ||
          k.toLowerCase().includes("phrase") ||
          k.toLowerCase().includes("template")
        );

        // Check if snippets is a property on user
        let userSnippets = null;
        if (user?.snippets) {
          userSnippets = {
            type: typeof user.snippets,
            isArray: Array.isArray(user.snippets),
            count: user.snippets.length || Object.keys(user.snippets).length || "unknown"
          };
        }

        // Try portal.invoke for snippet services
        const ga = window.GoogleAccount;
        let portalSnippetResult = null;
        const servicesToTry = [
          ["snippets", "list"],
          ["snippet", "list"],
          ["snippetInternal", "list"],
          ["snippetInternal", "listAsync"],
          ["draftInternal", "listSnippets"],
          ["userInternal", "getSnippets"]
        ];

        for (const [service, method] of servicesToTry) {
          try {
            const result = await ga.portal.invoke(service, method, []);
            if (result) {
              portalSnippetResult = {
                service,
                method,
                resultType: typeof result,
                isArray: Array.isArray(result),
                sample: JSON.stringify(result).slice(0, 500)
              };
              break;
            }
          } catch (e) {
            // continue
          }
        }

        // Check for snippets in localStorage or indexedDB
        let localStorageSnippets = null;
        for (const key of Object.keys(localStorage)) {
          if (key.toLowerCase().includes("snippet")) {
            localStorageSnippets = { key, preview: localStorage.getItem(key)?.slice(0, 200) };
            break;
          }
        }

        return {
          userKeys: userKeys.slice(0, 50),
          userSnippetKeys,
          userSnippets,
          portalSnippetResult,
          localStorageSnippets
        };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));

  // Close the compose window
  if (draftKey) {
    await closeCompose(conn, draftKey);
  }
  await disconnect(conn);
}

main().catch(console.error);
