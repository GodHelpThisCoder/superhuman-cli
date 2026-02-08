import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Check the portal invoke path for settings
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        if (!ga?.settings) return { error: "no settings" };

        // Get current snippets
        const snippets = ga.settings.get('snippets');

        // Check what the backgroundSettings.set actually does
        // by looking at the portal email (which account it goes to)
        const portalEmail = ga.portal?.email;

        // Check if there's a userId separate from email
        const userId = ga.settings._cache?.userId;
        const seatId = ga.settings._cache?.seatId;

        // Check if Account class has methods to list all accounts
        const accountClass = window.Account;
        const accountStaticMethods = accountClass ?
          Object.getOwnPropertyNames(accountClass).filter(k => typeof accountClass[k] === 'function') : null;

        // Check ViewState for account switching
        const vs = window.ViewState;
        const currentAccount = vs?.account;
        const accountEmail = currentAccount?.emailAddress;

        // Look for accounts in ViewState
        let allAccounts = null;
        if (vs?._accountController) {
          const ac = vs._accountController;
          allAccounts = {
            controllerKeys: Object.keys(ac),
            accounts: ac._accounts ? ac._accounts.map(a => a.emailAddress) : null
          };
        }

        return {
          portalEmail,
          userId,
          seatId,
          accountEmail,
          accountStaticMethods,
          allAccounts,
          snippetsPreview: JSON.stringify(snippets)?.slice(0, 200)
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("=== Snippet Scope Check ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Check if there's a way to access settings for a different account
  const multiAccountResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        // Look for account list or account manager
        const vs = window.ViewState;

        // Check for unified settings that might be shared
        const ga = window.GoogleAccount;
        const settingsCache = ga?.settings?._cache || {};

        // Check if profile or user info suggests account-independent storage
        const profile = settingsCache.profile;
        const library = settingsCache.library;

        // Check teams (shared across accounts)
        const teams = settingsCache.teams;

        return {
          hasProfile: !!profile,
          profilePreview: profile ? JSON.stringify(profile).slice(0, 200) : null,
          hasLibrary: !!library,
          hasTeams: !!teams,
          teamsPreview: teams ? JSON.stringify(teams).slice(0, 200) : null
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Multi-Account Settings ===\n");
  console.log(JSON.stringify(multiAccountResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
