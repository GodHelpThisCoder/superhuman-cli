import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const account = window.ViewState?.account;
        const settings = account?.settings;
        const cache = settings?._cache || {};

        // Search for anything that might be snippets/templates/phrases
        const possibleSnippetKeys = Object.keys(cache).filter(k =>
          k.toLowerCase().includes('snippet') ||
          k.toLowerCase().includes('template') ||
          k.toLowerCase().includes('phrase') ||
          k.toLowerCase().includes('canned') ||
          k.toLowerCase().includes('quick')
        );

        // Get all values for these keys
        const snippetRelated = {};
        for (const key of possibleSnippetKeys) {
          const val = cache[key];
          snippetRelated[key] = {
            type: typeof val,
            isEmpty: val === null || val === undefined ||
                    (typeof val === 'object' && Object.keys(val).length === 0),
            preview: JSON.stringify(val)?.slice(0, 500)
          };
        }

        // Also search the entire cache for any object that looks like snippets
        const suspiciousObjects = [];
        for (const [key, val] of Object.entries(cache)) {
          if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            const valStr = JSON.stringify(val);
            // Look for objects with shortcut/body structure
            if (valStr.includes('shortcut') || valStr.includes('body') ||
                valStr.includes('recording') || valStr.includes('student')) {
              suspiciousObjects.push({
                key,
                preview: valStr.slice(0, 300)
              });
            }
          }
        }

        return {
          currentEmail: account?.emailAddress,
          possibleSnippetKeys,
          snippetRelated,
          suspiciousObjects,
          allCacheKeys: Object.keys(cache)
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("=== Searching for UVA Snippets ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
