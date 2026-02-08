import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Get full snippets data
  const snippetsResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const settings = ga?.settings;
        if (!settings) return { error: "no settings" };

        // Get the raw snippets
        const snippets = settings._cache?.snippets;

        // Also check for methods on settings
        const proto = Object.getPrototypeOf(settings);
        const protoMethods = Object.getOwnPropertyNames(proto);
        const snippetMethods = protoMethods.filter(m =>
          m.toLowerCase().includes('snippet')
        );

        // Get all settings methods
        const allMethods = protoMethods.filter(m => typeof settings[m] === 'function');

        return {
          snippets: JSON.stringify(snippets),
          snippetsType: typeof snippets,
          snippetMethods,
          settingsMethods: allMethods.slice(0, 50)
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("=== Snippets Data ===\n");
  console.log(JSON.stringify(snippetsResult.result.value, null, 2));

  // Check if there's a Settings class with static methods
  const settingsClassResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const settings = ga?.settings;
        if (!settings) return { error: "no settings" };

        // Look for get/set methods
        const methods = [];
        const proto = Object.getPrototypeOf(settings);

        for (const key of Object.getOwnPropertyNames(proto)) {
          if (typeof settings[key] === 'function') {
            methods.push(key);
          }
        }

        // Try to find snippet-specific getters/setters
        const snippetRelated = methods.filter(m =>
          m.toLowerCase().includes('snippet') ||
          m.toLowerCase().includes('get') ||
          m.toLowerCase().includes('set') ||
          m.toLowerCase().includes('update') ||
          m.toLowerCase().includes('save')
        );

        return { snippetRelated };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Settings Methods ===\n");
  console.log(JSON.stringify(settingsClassResult.result.value, null, 2));

  // Try to use portal.invoke to find snippet services
  const portalResult = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        if (!ga?.portal) return { error: "no portal" };

        // Try various snippet service names
        const servicesToTry = [
          ['settingsInternal', 'getSnippets'],
          ['settingsInternal', 'listSnippets'],
          ['settingsInternal', 'get', ['snippets']],
          ['snippetInternal', 'list'],
          ['snippets', 'list'],
          ['userSettings', 'getSnippets'],
          ['userSettings', 'get', ['snippets']],
        ];

        const results = [];
        for (const [service, method, args] of servicesToTry) {
          try {
            const result = await ga.portal.invoke(service, method, args || []);
            results.push({ service, method, success: true, result: JSON.stringify(result)?.slice(0, 500) });
          } catch (e) {
            results.push({ service, method, success: false, error: e.message?.slice(0, 100) });
          }
        }

        return results;
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("\n=== Portal Service Exploration ===\n");
  console.log(JSON.stringify(portalResult.result.value, null, 2));

  // Check settings.account for snippet methods
  const settingsAccountResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const settings = ga?.settings;
        const account = settings?.account;
        if (!account) return { error: "no settings.account" };

        const proto = Object.getPrototypeOf(account);
        const methods = Object.getOwnPropertyNames(proto);
        const snippetMethods = methods.filter(m =>
          m.toLowerCase().includes('snippet')
        );

        // Also check for a snippets property
        const hasSnippets = 'snippets' in account;
        const snippetsType = hasSnippets ? typeof account.snippets : null;

        return { snippetMethods, hasSnippets, snippetsType, accountMethods: methods.slice(0, 30) };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Settings Account ===\n");
  console.log(JSON.stringify(settingsAccountResult.result.value, null, 2));

  // Try to directly call settings methods related to snippets
  const settingsCallResult = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const settings = ga?.settings;
        if (!settings) return { error: "no settings" };

        const results = [];

        // Try calling snippet-related methods
        if (typeof settings.getSnippets === 'function') {
          try {
            const r = await settings.getSnippets();
            results.push({ method: 'getSnippets', result: JSON.stringify(r)?.slice(0, 1000) });
          } catch (e) {
            results.push({ method: 'getSnippets', error: e.message });
          }
        }

        if (typeof settings.get === 'function') {
          try {
            const r = await settings.get('snippets');
            results.push({ method: 'get(snippets)', result: JSON.stringify(r)?.slice(0, 1000) });
          } catch (e) {
            results.push({ method: 'get(snippets)', error: e.message });
          }
        }

        // Check the _cache directly
        if (settings._cache?.snippets) {
          const s = settings._cache.snippets;
          const count = Object.keys(s).length;
          if (count > 0) {
            const firstKey = Object.keys(s)[0];
            results.push({
              method: '_cache.snippets',
              count,
              sampleKey: firstKey,
              sampleValue: JSON.stringify(s[firstKey])?.slice(0, 500)
            });
          } else {
            results.push({ method: '_cache.snippets', count: 0, note: 'empty' });
          }
        }

        return results;
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("\n=== Direct Settings Calls ===\n");
  console.log(JSON.stringify(settingsCallResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
