import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Check if there's a generic way to get the current account regardless of type
  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const findings = {};

        // Check ViewState.account - this should be the current account regardless of type
        const vs = window.ViewState;
        if (vs?.account) {
          findings.vsAccount = {
            email: vs.account.emailAddress,
            type: vs.account.constructor?.name,
            hasSettings: !!vs.account.settings,
            hasPortal: !!vs.account.portal
          };

          // Check if vs.account has the same interface as GoogleAccount
          if (vs.account.settings) {
            findings.vsAccountSettings = {
              hasGet: typeof vs.account.settings.get === 'function',
              hasSet: typeof vs.account.settings.set === 'function',
              cacheKeys: Object.keys(vs.account.settings._cache || {}).slice(0, 10)
            };
          }
        }

        // Check if GoogleAccount is actually vs.account
        const ga = window.GoogleAccount;
        findings.gaEqualsVsAccount = ga === vs?.account;

        // Check window.Account for current account getter
        const Account = window.Account;
        if (Account) {
          // Look for current() or active() method
          for (const method of ['current', 'active', 'get', 'default']) {
            if (typeof Account[method] === 'function') {
              try {
                const result = Account[method]();
                findings['Account.' + method] = {
                  email: result?.emailAddress,
                  type: result?.constructor?.name
                };
              } catch (e) {
                findings['Account.' + method + 'Error'] = e.message;
              }
            }
          }
        }

        // The safest way: use ViewState.account which should always be current
        return findings;
      })()
    `,
    returnByValue: true,
  });

  console.log("=== Generic Account Access ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Recommendation
  console.log("\n=== Recommendation ===\n");
  console.log("Use ViewState.account instead of GoogleAccount for universal access.");
  console.log("This should work for both Gmail and Outlook accounts.");

  await disconnect(conn);
}

main().catch(console.error);
