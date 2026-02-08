import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Deep search for snippets in app state
  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const findings = [];

        // 1. Check ViewState
        const vs = window.ViewState;
        if (vs) {
          // Check all top-level keys for snippet-related data
          for (const key of Object.keys(vs)) {
            const val = vs[key];
            if (typeof val === 'object' && val !== null) {
              const valStr = JSON.stringify(val).toLowerCase();
              if (valStr.includes('snippet') && valStr.length < 10000) {
                findings.push({ location: 'ViewState.' + key, hasSnippet: true, preview: JSON.stringify(val).slice(0, 500) });
              }
            }
          }
        }

        // 2. Check GoogleAccount
        const ga = window.GoogleAccount;
        if (ga) {
          // Check for snippet-related properties
          const gaKeys = Object.keys(ga);
          for (const key of gaKeys) {
            if (key.toLowerCase().includes('snippet') || key.toLowerCase().includes('phrase') || key.toLowerCase().includes('template')) {
              findings.push({ location: 'GoogleAccount.' + key, type: typeof ga[key] });
            }
          }

          // Check DI container for snippet services
          if (ga.di) {
            const diKeys = [];
            try {
              // Try to list DI bindings
              if (ga.di._bindings) {
                for (const [k, v] of ga.di._bindings.entries()) {
                  if (k.toLowerCase().includes('snippet') || k.toLowerCase().includes('phrase')) {
                    diKeys.push(k);
                  }
                }
              }
            } catch (e) {}
            if (diKeys.length > 0) {
              findings.push({ location: 'GoogleAccount.di._bindings', snippetKeys: diKeys });
            }
          }

          // Check threads/onDisk
          const account = ga;
          const threads = account?.threads;
          if (threads?.onDisk) {
            const onDisk = threads.onDisk;
            // Check for snippet properties
            for (const key of Object.keys(onDisk)) {
              if (key.toLowerCase().includes('snippet') || key.toLowerCase().includes('phrase')) {
                const val = onDisk[key];
                findings.push({
                  location: 'threads.onDisk.' + key,
                  type: typeof val,
                  isArray: Array.isArray(val),
                  count: Array.isArray(val) ? val.length : (typeof val === 'object' ? Object.keys(val).length : null),
                  preview: JSON.stringify(val)?.slice(0, 1000)
                });
              }
            }

            // Check user object
            const user = onDisk?.user;
            if (user) {
              for (const key of Object.keys(user)) {
                if (key.toLowerCase().includes('snippet') || key.toLowerCase().includes('phrase')) {
                  findings.push({
                    location: 'threads.onDisk.user.' + key,
                    type: typeof user[key],
                    preview: JSON.stringify(user[key])?.slice(0, 500)
                  });
                }
              }
            }
          }
        }

        // 3. Check localStorage
        for (const key of Object.keys(localStorage)) {
          if (key.toLowerCase().includes('snippet') || key.toLowerCase().includes('phrase')) {
            findings.push({
              location: 'localStorage.' + key,
              preview: localStorage.getItem(key)?.slice(0, 500)
            });
          }
        }

        // 4. Check indexedDB databases
        const dbNames = [];
        // Can't easily list indexedDB contents synchronously

        // 5. Try to find snippet controller or service
        if (vs?._composeFormController) {
          const draftKey = Object.keys(vs._composeFormController)[0];
          const ctrl = vs._composeFormController[draftKey];
          if (ctrl) {
            // Check controller for snippet methods
            const ctrlProto = Object.getPrototypeOf(ctrl);
            const snippetMethods = [];
            for (const key of Object.getOwnPropertyNames(ctrlProto)) {
              if (key.toLowerCase().includes('snippet')) {
                snippetMethods.push(key);
              }
            }
            if (snippetMethods.length > 0) {
              findings.push({ location: 'composeFormController', snippetMethods });
            }

            // Check if there's a snippet service on the controller
            if (ctrl.snippetService) {
              findings.push({ location: 'composeFormController.snippetService', exists: true });
            }
            if (ctrl._snippets) {
              findings.push({ location: 'composeFormController._snippets', type: typeof ctrl._snippets });
            }

            // Check props for snippets
            if (ctrl.props?.snippets) {
              findings.push({
                location: 'composeFormController.props.snippets',
                type: typeof ctrl.props.snippets,
                isArray: Array.isArray(ctrl.props.snippets),
                count: Array.isArray(ctrl.props.snippets) ? ctrl.props.snippets.length : Object.keys(ctrl.props.snippets).length,
                sample: JSON.stringify(ctrl.props.snippets)?.slice(0, 1000)
              });
            }
          }
        }

        // 6. Search in OnDisk more broadly
        if (window.OnDisk) {
          const odKeys = Object.keys(window.OnDisk);
          for (const key of odKeys) {
            if (key.toLowerCase().includes('snippet')) {
              findings.push({ location: 'OnDisk.' + key, exists: true });
            }
          }
        }

        // 7. Search the User object
        if (window.User) {
          const userKeys = Object.keys(window.User);
          for (const key of userKeys) {
            if (key.toLowerCase().includes('snippet') || key.toLowerCase().includes('phrase')) {
              findings.push({ location: 'User.' + key, type: typeof window.User[key] });
            }
          }
        }

        return findings;
      })()
    `,
    returnByValue: true,
  });

  console.log("=== Snippet Storage Search Results ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  // Now let's also look for snippets in the identityMap
  const identityMapResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.threads?.onDisk?.identityMap) return { error: "no identityMap" };

        const im = ga.threads.onDisk.identityMap;
        const snippetEntries = [];

        // Check all entries for snippet-related data
        for (const [key, value] of Object.entries(im)) {
          if (key.toLowerCase().includes('snippet') ||
              (typeof value === 'object' && value !== null &&
               JSON.stringify(value).toLowerCase().includes('snippet'))) {
            snippetEntries.push({
              key,
              valueType: typeof value,
              preview: JSON.stringify(value)?.slice(0, 300)
            });
          }
        }

        return { totalEntries: Object.keys(im).length, snippetEntries };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Identity Map Snippet Search ===\n");
  console.log(JSON.stringify(identityMapResult.result.value, null, 2));

  // Check for UserSettings or Settings object
  const settingsResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const results = [];

        // Check for Settings singleton
        if (window.Settings) {
          const sKeys = Object.keys(window.Settings);
          results.push({ location: 'Settings', keys: sKeys.slice(0, 50) });
        }

        // Check GoogleAccount settings
        const ga = window.GoogleAccount;
        if (ga?.settings) {
          results.push({
            location: 'GoogleAccount.settings',
            keys: Object.keys(ga.settings).slice(0, 50)
          });
        }

        // Check for UserData
        if (window.UserData) {
          results.push({ location: 'UserData', keys: Object.keys(window.UserData) });
        }

        // Check OnDisk.user for all keys
        if (ga?.threads?.onDisk?.user) {
          results.push({
            location: 'OnDisk.user',
            allKeys: Object.keys(ga.threads.onDisk.user)
          });
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Settings/UserData Search ===\n");
  console.log(JSON.stringify(settingsResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
