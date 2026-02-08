import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Create a unique test snippet and check if it's visible
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const account = window.ViewState?.account;
        if (!account) return { error: "no account" };

        const settings = account.settings;
        const currentEmail = account.emailAddress;

        // Get current snippets
        const snippetsBefore = settings.get('snippets') || {};

        // Create a test snippet with timestamp
        const testId = 'sharing_test_' + Date.now();
        const testSnippet = {
          shortcut: 'sharing-test-' + Date.now(),
          body: 'Created on account: ' + currentEmail,
          subject: ''
        };

        // Save it
        await settings.set('snippets', { ...snippetsBefore, [testId]: testSnippet });

        // Check the userId - this is the Superhuman user ID
        const userId = settings._cache?.userId;

        return {
          currentEmail,
          userId,
          testId,
          testSnippet,
          message: "Snippet created. Now switch to another account in Superhuman UI and run the verify script."
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("=== Test Snippet Created ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  console.log("\n=== Next Steps ===");
  console.log("1. Switch to a different account in Superhuman (e.g., UVA or NYU)");
  console.log("2. Run: bun verify-snippet-on-other-account.ts");
  console.log("3. This will tell us if snippets are shared across accounts\n");

  await disconnect(conn);
}

main().catch(console.error);
