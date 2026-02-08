import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const account = window.ViewState?.account;
        if (!account) return { error: "no account" };

        const settings = account.settings;

        // Key identifiers
        const currentEmail = account.emailAddress;
        const userId = settings._cache?.userId;
        const seatId = settings._cache?.seatId;

        // Get ALL account emails
        const allAccounts = window.Account?.accountList?.() || [];

        // Current snippets
        const snippets = settings.get('snippets') || {};
        const snippetCount = Object.keys(snippets).length;
        const snippetNames = Object.values(snippets).map(s => s.shortcut);

        // Check the settings path structure
        // If snippets were per-account, we'd expect the cache to be nested
        const cacheStructure = {
          topLevelKeys: Object.keys(settings._cache || {}).slice(0, 15),
          hasAccountPrefix: Object.keys(settings._cache || {}).some(k =>
            allAccounts.some(email => k.includes(email))
          )
        };

        return {
          currentEmail,
          userId,
          seatId,
          allAccounts,
          snippetCount,
          snippetNames,
          cacheStructure,
          interpretation: cacheStructure.hasAccountPrefix
            ? "Snippets appear to be PER-ACCOUNT (cache has account-prefixed keys)"
            : "Snippets appear to be SHARED at user level (no account prefix in cache)"
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("=== Snippet Storage Model Analysis ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Additional check: look at how the backend call is structured
  const backendCheck = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const account = window.ViewState?.account;
        const portal = account?.portal;

        // The portal.invoke call includes the account's email in its context
        // but the path "snippets" doesn't include account
        return {
          portalEmail: portal?.email,
          // When you call settings.set('snippets', value), it does:
          // portal.invoke("backgroundSettings", "set", ["snippets", value])
          // The backend then determines WHERE to store based on:
          // 1. The user's auth token (userId)
          // 2. Possibly the portal's email context
          conclusion: "The storage model depends on Superhuman's backend implementation. " +
                     "Based on UX (snippets should work everywhere), likely SHARED at user level."
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Backend Context ===\n");
  console.log(JSON.stringify(backendCheck.result.value, null, 2));

  console.log("\n=== Practical Answer ===\n");
  console.log("To definitively test: switch accounts in Superhuman and check if same snippets appear.");
  console.log("If yes -> snippets are SHARED (one API call works for all accounts)");
  console.log("If no -> snippets are PER-ACCOUNT (need to switch or access each account's settings)");

  await disconnect(conn);
}

main().catch(console.error);
