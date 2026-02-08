/**
 * Find and call Superhuman's internal ID generator
 */

import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  console.log("=== Finding Internal ID Generator ===\n");

  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    process.exit(1);
  }

  const { Runtime, client } = conn;

  // First, search for ID generation patterns in the source
  console.log("1. Searching for ID generation functions...\n");

  const searchResult = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Look for any function that returns event_ prefixed strings
        function findGenerators(obj, path, depth = 0) {
          if (depth > 3 || !obj || typeof obj !== 'object') return;

          try {
            for (const [key, value] of Object.entries(obj)) {
              if (typeof value === 'function') {
                const funcStr = value.toString();
                if (funcStr.includes('event_') ||
                    funcStr.includes('shortId') ||
                    funcStr.includes('nanoid') ||
                    funcStr.includes('cuid')) {
                  results[path + '.' + key] = funcStr.substring(0, 300);
                }
              } else if (typeof value === 'object' && value !== null) {
                findGenerators(value, path + '.' + key, depth + 1);
              }
            }
          } catch {}
        }

        // Search common locations
        if (window.GoogleAccount) findGenerators(window.GoogleAccount, 'GoogleAccount');
        if (window.ViewState) findGenerators(window.ViewState, 'ViewState');

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("Found generators:", JSON.stringify(searchResult.result.value, null, 2));

  // Try to find the shortId implementation by searching all global functions
  console.log("\n2. Looking for shortId module...\n");

  const shortIdSearch = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Search through window properties for shortId-like functions
        for (const key of Object.getOwnPropertyNames(window)) {
          try {
            const val = window[key];
            if (typeof val === 'function') {
              const str = val.toString();
              if (str.length < 500 && (str.includes('random') || str.includes('Math.random'))) {
                if (str.includes('charAt') || str.includes('characters') || str.includes('chars')) {
                  results[key] = str;
                }
              }
            }
          } catch {}
        }

        // Also check for webpack chunks that might have the ID generator
        if (window.webpackChunk_superhuman_desktop_webapp) {
          results.hasWebpackChunks = true;
          results.chunkCount = window.webpackChunk_superhuman_desktop_webapp.length;
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("shortId search:", JSON.stringify(shortIdSearch.result.value, null, 2));

  // Try to invoke the Ask AI UI and capture what ID it generates
  console.log("\n3. Trying to intercept actual ID generation...\n");

  // Install a more aggressive interceptor
  await Runtime.evaluate({
    expression: `
      (function() {
        // Store original Math.random
        const origRandom = Math.random;
        window.__idGenerationCalls = [];

        // Create a tracking wrapper
        let callCount = 0;
        Math.random = function() {
          const result = origRandom();
          callCount++;

          // Capture call stack to find ID generation
          if (callCount % 100 === 1) {
            const stack = new Error().stack;
            if (stack && (stack.includes('event') || stack.includes('id') || stack.includes('ID'))) {
              window.__idGenerationCalls.push({
                count: callCount,
                result,
                stack: stack.substring(0, 500)
              });
            }
          }
          return result;
        };

        console.log('Math.random interceptor installed');
      })()
    `
  });

  // Try to look in the Network domain for actual request patterns
  console.log("\n4. Looking for existing network requests with event IDs...\n");

  await conn.Network.enable();

  // Get network cache if available
  const cacheResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const results = {};

        // Check if there's a cache we can access
        try {
          const keys = await caches.keys();
          results.cacheKeys = keys;

          for (const cacheName of keys) {
            const cache = await caches.open(cacheName);
            const requests = await cache.keys();
            const aiRequests = requests.filter(r => r.url.includes('ai.') || r.url.includes('askAI'));
            if (aiRequests.length > 0) {
              results[cacheName] = aiRequests.map(r => r.url);

              // Try to get cached responses
              for (const req of aiRequests.slice(0, 3)) {
                try {
                  const resp = await cache.match(req);
                  if (resp) {
                    const text = await resp.text();
                    if (text.includes('event_')) {
                      results[cacheName + '_hasEventId'] = true;
                    }
                  }
                } catch {}
              }
            }
          }
        } catch (e) {
          results.cacheError = e.message;
        }

        return results;
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("Cache results:", JSON.stringify(cacheResult.result.value, null, 2));

  // Check for any API client objects
  console.log("\n5. Looking for API client methods...\n");

  const apiClientSearch = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Look for any object with 'api' in the name that has AI methods
        const ga = window.GoogleAccount;

        if (ga?.backend) {
          const backend = ga.backend;
          const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(backend) || {});
          const aiMethods = methods.filter(m =>
            m.toLowerCase().includes('ai') ||
            m.toLowerCase().includes('ask')
          );
          results.backendAIMethods = aiMethods;
        }

        // Look for fetch wrapper
        if (ga?.fetcher) {
          results.hasFetcher = true;
          const fetcherMethods = Object.keys(ga.fetcher);
          results.fetcherMethods = fetcherMethods;
        }

        // Search for any askAI method
        function findAskAI(obj, path, depth = 0) {
          if (depth > 3 || !obj || typeof obj !== 'object') return;

          try {
            for (const [key, value] of Object.entries(obj)) {
              if (typeof value === 'function' && key.toLowerCase().includes('ask')) {
                results[path + '.' + key] = {
                  type: 'function',
                  signature: value.toString().substring(0, 100)
                };
              } else if (typeof value === 'object' && value !== null) {
                findAskAI(value, path + '.' + key, depth + 1);
              }
            }
          } catch {}
        }

        findAskAI(ga, 'GoogleAccount');

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("API client search:", JSON.stringify(apiClientSearch.result.value, null, 2));

  // Try to find the actual code that creates event IDs
  console.log("\n6. Searching webpack modules for event ID generation...\n");

  const webpackSearch = await Runtime.evaluate({
    expression: `
      (() => {
        const results = { found: [] };

        // Search webpack chunks for event_ string
        if (window.webpackChunk_superhuman_desktop_webapp) {
          for (const chunk of window.webpackChunk_superhuman_desktop_webapp) {
            if (Array.isArray(chunk) && chunk[1]) {
              for (const [moduleId, moduleFunc] of Object.entries(chunk[1])) {
                try {
                  const funcStr = moduleFunc.toString();
                  if (funcStr.includes('"event_"') || funcStr.includes("'event_'")) {
                    // Found a module that uses event_ prefix
                    const snippet = funcStr.substring(0, 1000);
                    results.found.push({
                      moduleId,
                      snippet: snippet.substring(funcStr.indexOf('event_') - 50, funcStr.indexOf('event_') + 200)
                    });
                  }
                } catch {}
              }
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("Webpack search results:", JSON.stringify(webpackSearch.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
