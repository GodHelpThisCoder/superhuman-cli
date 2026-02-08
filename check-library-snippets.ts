import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const account = window.ViewState?.account;
        const settings = account?.settings;
        const cache = settings?._cache || {};

        // Check library object
        const library = cache.library;

        // Try to load snippets from backend
        let loadedSnippets = null;
        try {
          // settings.loadFromRemote might refresh the cache
          if (settings?.loadFromRemote) {
            await settings.loadFromRemote();
            loadedSnippets = settings.get('snippets');
          }
        } catch (e) {
          loadedSnippets = { error: e.message };
        }

        // Check if there's a snippets service in DI
        let snippetService = null;
        const di = account?.di;
        if (di) {
          try {
            const keys = [...(di._bindings?.keys?.() || [])];
            const snippetKeys = keys.filter(k =>
              k.toLowerCase().includes('snippet')
            );
            snippetService = { keys: snippetKeys };

            // Try to get the snippet service
            for (const key of snippetKeys) {
              try {
                const svc = di.get(key);
                if (svc) {
                  snippetService[key] = {
                    type: typeof svc,
                    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(svc)).slice(0, 20)
                  };
                }
              } catch (e) {}
            }
          } catch (e) {
            snippetService = { error: e.message };
          }
        }

        // Try portal.invoke to get snippets directly from backend
        let backendSnippets = null;
        try {
          const portal = account?.portal;
          if (portal) {
            backendSnippets = await portal.invoke("backgroundSettings", "get", ["snippets"]);
          }
        } catch (e) {
          backendSnippets = { error: e.message };
        }

        return {
          currentEmail: account?.emailAddress,
          libraryKeys: library ? Object.keys(library) : null,
          libraryPreview: library ? JSON.stringify(library).slice(0, 500) : null,
          loadedSnippets,
          snippetService,
          backendSnippets,
          cacheSnippetsAfterLoad: settings?.get?.('snippets')
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("=== Deep Search for Snippets ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
