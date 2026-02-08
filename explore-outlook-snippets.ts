import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Check if there are multiple accounts and how snippets work across them
  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const findings = {};

        // Check for MicrosoftAccount or OutlookAccount
        if (window.MicrosoftAccount) {
          findings.hasMicrosoftAccount = true;
          findings.microsoftAccountKeys = Object.keys(window.MicrosoftAccount).slice(0, 30);

          // Check for settings on Microsoft account
          if (window.MicrosoftAccount.settings) {
            findings.microsoftSettings = {
              hasSettings: true,
              cacheKeys: window.MicrosoftAccount.settings._cache ?
                Object.keys(window.MicrosoftAccount.settings._cache) : null
            };
          }
        }

        // Check ViewState for multiple accounts
        const vs = window.ViewState;
        if (vs) {
          // Look for account-related properties
          const accountProps = Object.keys(vs).filter(k =>
            k.toLowerCase().includes('account')
          );
          findings.viewStateAccountProps = accountProps;

          // Check for accounts array
          if (vs._accounts || vs.accounts) {
            const accounts = vs._accounts || vs.accounts;
            findings.accountsCount = Array.isArray(accounts) ? accounts.length : 'not array';
          }
        }

        // Check GoogleAccount structure
        const ga = window.GoogleAccount;
        if (ga) {
          findings.googleAccountType = ga.constructor?.name;

          // Check if snippets are stored at account level or shared
          const settings = ga.settings;
          if (settings) {
            findings.googleSettingsAccount = settings.account?.constructor?.name;

            // Check if there's a shared settings store
            if (settings._sharedCache) {
              findings.hasSharedCache = true;
            }
          }
        }

        // Look for a global Accounts or AccountManager
        const globalKeys = Object.keys(window).filter(k =>
          k.toLowerCase().includes('account') &&
          typeof window[k] === 'object' &&
          window[k] !== null
        );
        findings.globalAccountKeys = globalKeys;

        // Check for AccountSwitcher or similar
        if (window.AccountSwitcher) {
          findings.hasAccountSwitcher = true;
        }

        return findings;
      })()
    `,
    returnByValue: true,
  });

  console.log("=== Account Structure ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Check if snippets are actually per-account or global
  const snippetScopeResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.settings) return { error: "no settings" };

        // Check the settings.set method to understand where data goes
        const setMethod = ga.settings.set?.toString?.();

        // Check if there's an accountId in the settings path
        const accountId = ga.settings.account?._accountId ||
                         ga.settings.account?.emailAddress ||
                         ga._accountId;

        // Check the _cache structure
        const cacheStructure = {
          hasSnippets: 'snippets' in (ga.settings._cache || {}),
          topLevelKeys: Object.keys(ga.settings._cache || {}).slice(0, 20)
        };

        return {
          accountId,
          cacheStructure,
          setMethodPreview: setMethod?.slice(0, 300)
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Snippet Scope Analysis ===\n");
  console.log(JSON.stringify(snippetScopeResult.result.value, null, 2));

  // Check for base Account class that both Google and Microsoft might inherit from
  const baseAccountResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga) return { error: "no GoogleAccount" };

        // Get prototype chain
        const protoChain = [];
        let proto = Object.getPrototypeOf(ga);
        while (proto && proto !== Object.prototype) {
          protoChain.push(proto.constructor?.name || 'anonymous');
          proto = Object.getPrototypeOf(proto);
        }

        // Check if settings has a common interface
        const settingsProto = ga.settings ?
          Object.getPrototypeOf(ga.settings)?.constructor?.name : null;

        return {
          protoChain,
          settingsProto,
          hasPortal: !!ga.portal,
          portalMethods: ga.portal ? Object.keys(ga.portal).slice(0, 20) : null
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Base Account Analysis ===\n");
  console.log(JSON.stringify(baseAccountResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
