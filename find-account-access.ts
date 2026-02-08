import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Try to find a way to access other accounts' settings
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const findings = {};

        const allAccounts = window.Account?.accountList?.() || [];
        findings.allAccounts = allAccounts;

        const currentEmail = window.ViewState?.account?.emailAddress;
        findings.currentEmail = currentEmail;

        // Try to find where other accounts might be loaded or accessible
        // Check if there's an accounts map somewhere

        // 1. Check if backgroundSettings can access by email
        const account = window.ViewState?.account;
        const portal = account?.portal;

        // 2. Try to invoke backgroundSettings with account-specific path
        if (portal) {
          try {
            // Maybe the path can include account?
            const result = await portal.invoke("backgroundSettings", "get", ["snippets"]);
            findings.directGet = { success: true, result: JSON.stringify(result)?.slice(0, 200) };
          } catch (e) {
            findings.directGet = { error: e.message };
          }

          // Try getting for a specific account
          for (const email of allAccounts) {
            if (email !== currentEmail) {
              try {
                // Try various path formats
                const paths = [
                  email + "/snippets",
                  "accounts/" + email + "/snippets",
                  "users/" + email + "/snippets"
                ];
                for (const path of paths) {
                  const result = await portal.invoke("backgroundSettings", "get", [path]);
                  if (result && Object.keys(result).length > 0) {
                    findings.otherAccountAccess = { path, email, result: JSON.stringify(result)?.slice(0, 200) };
                    break;
                  }
                }
              } catch (e) {
                // continue
              }
              break; // Only try first other account
            }
          }
        }

        // 3. Check if there's a way to get account object by email
        const Account = window.Account;
        if (Account) {
          // Look for methods that take email
          const methods = Object.getOwnPropertyNames(Account).filter(k => typeof Account[k] === 'function');
          findings.accountMethods = methods;

          // Try Account.for(email) or similar
          for (const email of allAccounts) {
            if (email !== currentEmail) {
              for (const method of ['for', 'get', 'byEmail', 'forEmail', 'getAccount']) {
                if (typeof Account[method] === 'function') {
                  try {
                    const acc = await Account[method](email);
                    if (acc && acc.settings) {
                      findings.accountAccess = {
                        method,
                        email,
                        hasSettings: true,
                        settingsType: typeof acc.settings.get
                      };
                      // Try to get snippets
                      const snippets = acc.settings.get?.('snippets');
                      findings.otherAccountSnippets = {
                        email,
                        count: snippets ? Object.keys(snippets).length : 0,
                        names: snippets ? Object.values(snippets).map(s => s.shortcut) : []
                      };
                      break;
                    }
                  } catch (e) {
                    // continue
                  }
                }
              }
            }
          }
        }

        return findings;
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("=== Finding Access to Other Accounts ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
