/**
 * Explore the aiCompose and related backend methods
 */

import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  console.log("=== Exploring AI Compose Methods ===\n");

  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  // Inspect the backend's AI methods
  console.log("1. Inspecting backend AI methods...\n");

  const backendInspect = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};
        const ga = window.GoogleAccount;
        const backend = ga?.backend;

        if (!backend) return { error: 'No backend found' };

        // Get the prototype to see method signatures
        const proto = Object.getPrototypeOf(backend);
        const aiMethods = ['aiCompose', 'aiComposeEdit', 'aiComposeAgentic', 'getAICalendarDetails'];

        for (const method of aiMethods) {
          if (proto[method]) {
            results[method] = {
              exists: true,
              signature: proto[method].toString().substring(0, 500)
            };
          }
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("Backend AI methods:", JSON.stringify(backendInspect.result.value, null, 2));

  // Look for the AI service that handles Ask AI
  console.log("\n2. Looking for AI sidebar/service...\n");

  const aiServiceSearch = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};
        const ga = window.GoogleAccount;

        // Search for any property that contains 'ai' or 'ask'
        function searchObj(obj, path, depth = 0) {
          if (depth > 4 || !obj || typeof obj !== 'object') return;

          try {
            const keys = Object.keys(obj);
            for (const key of keys) {
              if (key.toLowerCase().includes('askai') ||
                  key.toLowerCase().includes('sidebar') && key.toLowerCase().includes('ai')) {
                results[path + '.' + key] = {
                  type: typeof obj[key],
                  keys: typeof obj[key] === 'object' ? Object.keys(obj[key] || {}).slice(0, 20) : null
                };
              }
            }
          } catch {}
        }

        searchObj(ga, 'GoogleAccount');
        searchObj(window.ViewState, 'ViewState');

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("AI service search:", JSON.stringify(aiServiceSearch.result.value, null, 2));

  // Look for the shortId implementation in the backend source
  console.log("\n3. Searching backend source for shortId...\n");

  const shortIdSource = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};
        const ga = window.GoogleAccount;
        const backend = ga?.backend;

        if (backend) {
          // Search through all methods
          const proto = Object.getPrototypeOf(backend);
          for (const methodName of Object.getOwnPropertyNames(proto)) {
            try {
              const method = proto[methodName];
              if (typeof method === 'function') {
                const str = method.toString();
                if (str.includes('shortId') || str.includes('event_') || str.includes('generateId')) {
                  results[methodName] = str.substring(0, 300);
                }
              }
            } catch {}
          }
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("shortId in backend:", JSON.stringify(shortIdSource.result.value, null, 2));

  // Check if there's a separate shortId module/utility
  console.log("\n4. Looking for shortId utility...\n");

  const utilitySearch = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Check if there's a global shortId function
        if (typeof shortId === 'function') {
          results.globalShortId = shortId.toString();
        }

        // Look in common utility locations
        const ga = window.GoogleAccount;

        // Check if backend has a shortId generator we can call
        if (ga?.backend?.shortId) {
          results.backendShortId = ga.backend.shortId.toString();
        }

        // Look for a static method
        if (ga?.Backend?.shortId) {
          results.BackendStaticShortId = ga.Backend.shortId.toString();
        }

        // Check constructors
        if (ga?.backend?.constructor?.shortId) {
          results.constructorShortId = ga.backend.constructor.shortId.toString();
        }

        // Try to find it in the prototype chain
        let proto = ga?.backend;
        let depth = 0;
        while (proto && depth < 5) {
          if (proto.shortId) {
            results['proto' + depth + '.shortId'] = proto.shortId.toString().substring(0, 200);
          }
          proto = Object.getPrototypeOf(proto);
          depth++;
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("Utility search:", JSON.stringify(utilitySearch.result.value, null, 2));

  // Try calling the aiCompose method to see how it generates IDs
  console.log("\n5. Inspecting AI compose call flow...\n");

  const aiComposeInspect = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};
        const ga = window.GoogleAccount;
        const backend = ga?.backend;

        // Find the aiCompose method and trace its dependencies
        const aiCompose = Object.getPrototypeOf(backend)?.aiCompose;
        if (aiCompose) {
          const source = aiCompose.toString();
          results.aiComposeSource = source;

          // Look for any ID-related calls in the source
          const idPatterns = source.match(/[a-zA-Z_]+[Ii]d[^a-zA-Z]/g);
          results.idPatterns = [...new Set(idPatterns || [])];
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("AI compose inspection:", JSON.stringify(aiComposeInspect.result.value, null, 2));

  // Look for the actual network call implementation
  console.log("\n6. Tracing network request generation...\n");

  const networkTrace = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Look for the API client that makes the actual requests
        const ga = window.GoogleAccount;

        // Check for a fetcher or API client
        if (ga?.fetcher) {
          const fetcherProto = Object.getPrototypeOf(ga.fetcher);
          const methods = Object.getOwnPropertyNames(fetcherProto);
          results.fetcherMethods = methods;

          // Look for methods that might generate event IDs
          for (const method of methods) {
            try {
              const fn = fetcherProto[method];
              if (typeof fn === 'function') {
                const str = fn.toString();
                if (str.includes('event_') || str.includes('eventId') || str.includes('question')) {
                  results[method + '_source'] = str.substring(0, 400);
                }
              }
            } catch {}
          }
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("Network trace:", JSON.stringify(networkTrace.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
