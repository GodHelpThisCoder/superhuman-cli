import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Try to access other accounts
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const findings = {};

        // Get account list
        const accounts = window.Account?.accountList?.() || [];
        findings.allEmails = accounts;

        // Try to find how to get account by email
        const Account = window.Account;
        if (Account) {
          // Check for static methods to get account
          const staticMethods = Object.getOwnPropertyNames(Account).filter(k =>
            typeof Account[k] === 'function'
          );
          findings.accountStaticMethods = staticMethods.filter(m =>
            m.toLowerCase().includes('get') ||
            m.toLowerCase().includes('by') ||
            m.toLowerCase().includes('find') ||
            m.toLowerCase().includes('for')
          );

          // Try Account.for() or Account.get() or Account.byEmail()
          for (const method of ['for', 'get', 'byEmail', 'getByEmail', 'forEmail']) {
            if (typeof Account[method] === 'function') {
              try {
                const acc = Account[method](accounts[1]); // Try second account
                if (acc) {
                  findings[method + 'Result'] = {
                    email: acc.emailAddress,
                    hasSettings: !!acc.settings,
                    type: acc.constructor?.name
                  };
                }
              } catch (e) {
                findings[method + 'Error'] = e.message;
              }
            }
          }
        }

        // Check ViewState for account access
        const vs = window.ViewState;
        if (vs?.account) {
          findings.currentAccount = {
            email: vs.account.emailAddress,
            type: vs.account.constructor?.name
          };
        }

        // Check if there's a way to switch accounts via ViewState
        const vsProto = vs ? Object.getPrototypeOf(vs) : null;
        if (vsProto) {
          const vsMethods = Object.getOwnPropertyNames(vsProto);
          findings.vsAccountMethods = vsMethods.filter(m =>
            m.toLowerCase().includes('account') ||
            m.toLowerCase().includes('switch')
          );
        }

        return findings;
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("=== Access Other Accounts ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Try to use ViewState.switchAccount or similar
  const switchResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const vs = window.ViewState;
        const accounts = window.Account?.accountList?.() || [];

        // Check if there's an internal account map
        // Often frameworks store loaded accounts somewhere
        const globalKeys = Object.keys(window);
        const accountMaps = {};

        for (const key of globalKeys) {
          try {
            const val = window[key];
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              // Check if it has account emails as keys
              const valKeys = Object.keys(val);
              const hasAccountEmail = accounts.some(email => valKeys.includes(email));
              if (hasAccountEmail) {
                accountMaps[key] = valKeys.filter(k => accounts.includes(k));
              }
            }
          } catch (e) {}
        }

        // Check Account constructor for instance tracking
        const Account = window.Account;
        let instanceTracking = null;
        if (Account) {
          instanceTracking = {
            _instances: Account._instances ? Object.keys(Account._instances) : null,
            _accounts: Account._accounts ? Account._accounts.map(a => a.emailAddress) : null,
            _byEmail: Account._byEmail ? Object.keys(Account._byEmail) : null
          };
        }

        return { accountMaps, instanceTracking };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Account Instance Tracking ===\n");
  console.log(JSON.stringify(switchResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
