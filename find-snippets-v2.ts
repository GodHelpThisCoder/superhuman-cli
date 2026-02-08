import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Check settings._cache
  const cacheResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.settings?._cache) return { error: "no _cache" };

        const cache = ga.settings._cache;
        const keys = Object.keys(cache);

        // Find snippet-related keys
        const snippetKeys = keys.filter(k =>
          k.toLowerCase().includes('snippet') ||
          k.toLowerCase().includes('phrase') ||
          k.toLowerCase().includes('template')
        );

        // Get preview of snippet data
        const snippetData = {};
        for (const k of snippetKeys) {
          snippetData[k] = {
            type: typeof cache[k],
            isArray: Array.isArray(cache[k]),
            preview: JSON.stringify(cache[k])?.slice(0, 1000)
          };
        }

        return {
          totalCacheKeys: keys.length,
          allKeys: keys,
          snippetKeys,
          snippetData
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("=== Settings Cache ===\n");
  console.log(JSON.stringify(cacheResult.result.value, null, 2));

  // Check miscSettings specifically
  const miscResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const user = ga?.threads?.onDisk?.user;
        if (!user?._miscSettings) return { error: "no _miscSettings" };

        const misc = user._miscSettings;
        return {
          type: typeof misc,
          keys: Object.keys(misc),
          hasSnippets: JSON.stringify(misc).toLowerCase().includes('snippet'),
          preview: JSON.stringify(misc).slice(0, 2000)
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Misc Settings ===\n");
  console.log(JSON.stringify(miscResult.result.value, null, 2));

  // Search globally for "snippet" in window properties
  const globalSearch = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const found = [];

        // Check window properties
        for (const key of Object.getOwnPropertyNames(window)) {
          try {
            const val = window[key];
            if (typeof val === 'object' && val !== null && key !== 'window') {
              const str = JSON.stringify(val);
              if (str && str.toLowerCase().includes('"snippet"') && str.length < 50000) {
                found.push({
                  location: 'window.' + key,
                  preview: str.slice(0, 500)
                });
              }
            }
          } catch (e) {
            // Skip inaccessible properties
          }
        }

        return found.slice(0, 10);
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Global Window Search for 'snippet' ===\n");
  console.log(JSON.stringify(globalSearch.result.value, null, 2));

  // Try accessing OnDisk class/prototype
  const onDiskProto = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const onDisk = ga?.threads?.onDisk;
        if (!onDisk) return { error: "no onDisk" };

        const proto = Object.getPrototypeOf(onDisk);
        const protoKeys = Object.getOwnPropertyNames(proto);
        const snippetKeys = protoKeys.filter(k => k.toLowerCase().includes('snippet'));

        // Also check instance properties
        const instanceKeys = Object.keys(onDisk);
        const instanceSnippetKeys = instanceKeys.filter(k => k.toLowerCase().includes('snippet'));

        return {
          protoSnippetKeys: snippetKeys,
          instanceSnippetKeys: instanceSnippetKeys,
          allInstanceKeys: instanceKeys.slice(0, 30)
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== OnDisk Object Keys ===\n");
  console.log(JSON.stringify(onDiskProto.result.value, null, 2));

  // Check for snippets in compose form controller props
  const composePropsResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const vs = window.ViewState;
        const cfc = vs?._composeFormController;
        if (!cfc) return { error: "no _composeFormController" };

        const draftKey = Object.keys(cfc)[0];
        const ctrl = cfc[draftKey];
        if (!ctrl) return { error: "no controller" };

        const propsKeys = ctrl.props ? Object.keys(ctrl.props) : [];
        const snippetRelated = propsKeys.filter(k =>
          k.toLowerCase().includes('snippet') ||
          k.toLowerCase().includes('phrase')
        );

        // Check account props
        const accountKeys = ctrl.props?.account ? Object.keys(ctrl.props.account) : [];
        const accountSnippetKeys = accountKeys.filter(k =>
          k.toLowerCase().includes('snippet') ||
          k.toLowerCase().includes('phrase')
        );

        return {
          propsKeys: propsKeys,
          snippetRelated,
          accountKeys: accountKeys.slice(0, 30),
          accountSnippetKeys
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Compose Controller Props ===\n");
  console.log(JSON.stringify(composePropsResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
