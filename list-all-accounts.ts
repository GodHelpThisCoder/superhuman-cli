import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Get the actual account list with details
  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const findings = {};

        // Account.accountList() returns something - let's see what
        const Account = window.Account;
        if (Account?.accountList) {
          const list = Account.accountList();
          findings.accountList = list;
          findings.accountListType = typeof list;
          if (Array.isArray(list) && list.length > 0) {
            findings.firstItem = {
              value: list[0],
              type: typeof list[0]
            };
          }
        }

        // Check ViewState._accountController more thoroughly
        const vs = window.ViewState;
        if (vs?._accountController) {
          const ac = vs._accountController;
          findings.accountControllerKeys = Object.keys(ac);

          // Try to get accounts from controller
          if (ac.accounts) {
            findings.controllerAccounts = ac.accounts.map?.(a => ({
              email: a.emailAddress,
              type: a.constructor?.name
            }));
          }

          if (ac._accountsByEmail) {
            findings.accountsByEmail = Object.keys(ac._accountsByEmail);
          }

          if (ac._accountsById) {
            findings.accountsById = Object.keys(ac._accountsById);
          }
        }

        // Check if there's an accounts getter on ViewState
        if (vs?.accounts) {
          findings.vsAccounts = vs.accounts.map?.(a => a.emailAddress) || typeof vs.accounts;
        }

        // Look at window objects for other account types
        const windowKeys = Object.keys(window);
        findings.accountRelatedGlobals = windowKeys.filter(k =>
          (k.includes('Account') || k.includes('account')) &&
          !k.includes('accountList')
        );

        return findings;
      })()
    `,
    returnByValue: true,
  });

  console.log("=== All Accounts ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Try to access accounts through a different method
  const accountsResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        // Try to find all loaded accounts
        const vs = window.ViewState;

        // Check if there's a map of accounts
        const ga = window.GoogleAccount;
        if (ga) {
          // Check if GoogleAccount is actually a reference to the current account
          // and there might be other accounts
          return {
            gaEmail: ga.emailAddress,
            gaType: ga.constructor?.name,
            gaSettingsEmail: ga.settings?.account?.emailAddress,
            // Check di container for account references
            diKeys: ga.di ? [...(ga.di._bindings?.keys?.() || [])].slice(0, 30) : null
          };
        }

        return { error: "no GoogleAccount" };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Current Account Details ===\n");
  console.log(JSON.stringify(accountsResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
