import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Check if ViewState has a shared settings or if Account.accountList() can give us all accounts
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const findings = {};

        // Try Account.accountList()
        const Account = window.Account;
        if (Account?.accountList) {
          try {
            const accounts = Account.accountList();
            findings.accountListResult = {
              count: accounts?.length,
              emails: accounts?.map(a => a.emailAddress || a.email),
              types: accounts?.map(a => a.constructor?.name)
            };

            // Check if each account has its own settings with snippets
            if (accounts?.length > 0) {
              findings.accountSettings = [];
              for (const acc of accounts) {
                const accSettings = acc.settings;
                if (accSettings) {
                  findings.accountSettings.push({
                    email: acc.emailAddress,
                    hasSnippets: 'snippets' in (accSettings._cache || {}),
                    snippetsValue: accSettings.get?.('snippets')
                  });
                }
              }
            }
          } catch (e) {
            findings.accountListError = e.message;
          }
        }

        // Check ViewState for global/shared settings
        const vs = window.ViewState;
        if (vs) {
          // Look for shared settings
          if (vs._sharedSettings) {
            findings.hasSharedSettings = true;
          }

          // Check if there's a global snippets store
          const vsKeys = Object.keys(vs);
          const snippetRelated = vsKeys.filter(k =>
            k.toLowerCase().includes('snippet')
          );
          findings.viewStateSnippetKeys = snippetRelated;
        }

        // Check if there's a UserSettings singleton
        if (window.UserSettings) {
          findings.hasUserSettings = true;
          findings.userSettingsKeys = Object.keys(window.UserSettings).slice(0, 20);
        }

        // Check if the current GoogleAccount's settings userId matches across potential accounts
        const ga = window.GoogleAccount;
        if (ga?.settings) {
          findings.currentAccountUserId = ga.settings._cache?.userId;
          findings.currentAccountEmail = ga.emailAddress || ga.settings.account?.emailAddress;
        }

        return findings;
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("=== Shared Snippets Check ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
