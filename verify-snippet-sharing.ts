import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Check if snippets are tied to userId (shared) or accountEmail (per-account)
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        if (!ga?.settings) return { error: "no settings" };

        const settings = ga.settings;

        // Get user identifiers
        const userId = settings._cache?.userId;
        const seatId = settings._cache?.seatId;
        const accountEmail = ga.emailAddress;

        // Check the backgroundSettings service to see how it stores data
        // The key insight is whether the storage path includes accountEmail or not

        // Create a test snippet
        const testId = 'verify_sharing_' + Date.now();
        const currentSnippets = settings.get('snippets') || {};

        // Add test snippet
        const newSnippets = {
          ...currentSnippets,
          [testId]: {
            shortcut: 'verify-sharing-test',
            body: 'Testing if snippets are shared across accounts',
            subject: ''
          }
        };

        await settings.set('snippets', newSnippets);

        // Now check if we can find how the data is stored
        // by examining the portal invoke parameters
        const portalEmail = ga.portal?.email;

        // Check if there's a way to see the actual storage path
        const settingsProto = Object.getPrototypeOf(settings);
        const setFuncStr = settings.set?.toString?.() || '';

        // Clean up - remove test snippet
        delete newSnippets[testId];
        await settings.set('snippets', newSnippets);

        return {
          userId,
          seatId,
          accountEmail,
          portalEmail,
          // The set function shows: portal.invoke("backgroundSettings", "set", [path, value])
          // If path is just "snippets" (not "accounts/email/snippets"), it's shared
          setFunctionHint: setFuncStr.slice(0, 400),
          // Check what the actual path looks like
          snippetsPath: 'snippets' // This is what we're passing
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("=== Snippet Sharing Verification ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Also check if the backend differentiates by looking at network calls
  console.log("\n=== Analysis ===\n");
  console.log("The set function invokes: portal.invoke('backgroundSettings', 'set', [path, value])");
  console.log("If path is just 'snippets' (not prefixed with account), snippets are USER-level (shared).");
  console.log("The userId is the Superhuman user ID that's consistent across all email accounts.");

  await disconnect(conn);
}

main().catch(console.error);
