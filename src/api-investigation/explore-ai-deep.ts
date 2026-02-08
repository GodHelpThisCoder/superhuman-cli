/**
 * Deep exploration for Superhuman AI API
 *
 * Explores all possible locations for AI functionality:
 * - Window object properties
 * - Global namespaces
 * - Lazy-loaded services
 * - WebSocket connections
 * - GraphQL schemas
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

const CDP_PORT = 9333;

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(CDP_PORT);

  if (!conn) {
    console.error("Failed to connect. Make sure Superhuman is running with CDP.");
    process.exit(1);
  }

  const { Runtime, Network } = conn;
  await Network.enable();

  // 1. Search all window properties for AI-related terms
  console.log("\n=== Searching Window Object for AI Properties ===\n");

  const windowResult = await Runtime.evaluate({
    expression: `
      (() => {
        const aiTerms = ['ai', 'assist', 'smart', 'suggest', 'generate', 'summarize', 'compose', 'llm', 'gpt', 'claude', 'anthropic', 'openai'];
        const found = {};

        // Search window properties
        for (const key of Object.keys(window)) {
          const lowerKey = key.toLowerCase();
          if (aiTerms.some(term => lowerKey.includes(term))) {
            found['window.' + key] = typeof window[key];
          }
        }

        // Search GoogleAccount if exists
        const ga = window.GoogleAccount;
        if (ga) {
          for (const key of Object.keys(ga)) {
            const lowerKey = key.toLowerCase();
            if (aiTerms.some(term => lowerKey.includes(term))) {
              found['GoogleAccount.' + key] = typeof ga[key];
            }
          }

          // Search GoogleAccount.di._services
          if (ga.di && ga.di._services) {
            for (const key of Object.keys(ga.di._services)) {
              const lowerKey = key.toLowerCase();
              if (aiTerms.some(term => lowerKey.includes(term))) {
                found['di._services.' + key] = 'service';
              }
            }
          }
        }

        return found;
      })()
    `,
    returnByValue: true,
  });

  console.log("AI-related properties found:", JSON.stringify(windowResult.result.value, null, 2));

  // 2. List ALL services in DI container
  console.log("\n=== All DI Services (first 100) ===\n");

  const allServicesResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga || !ga.di || !ga.di._services) return [];
        return Object.keys(ga.di._services).slice(0, 100);
      })()
    `,
    returnByValue: true,
  });

  console.log("Services:", JSON.stringify(allServicesResult.result.value, null, 2));

  // 3. List ALL backend methods
  console.log("\n=== All Backend Methods ===\n");

  const backendMethodsResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga || !ga.backend) return [];
        return Object.keys(ga.backend).filter(k => typeof ga.backend[k] === 'function');
      })()
    `,
    returnByValue: true,
  });

  console.log("Backend methods:", JSON.stringify(backendMethodsResult.result.value, null, 2));

  // 4. Search for prototype methods on backend
  console.log("\n=== Backend Prototype Methods ===\n");

  const protoResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga || !ga.backend) return [];
        const proto = Object.getPrototypeOf(ga.backend);
        if (!proto) return [];
        return Object.getOwnPropertyNames(proto).filter(k => typeof proto[k] === 'function' && k !== 'constructor');
      })()
    `,
    returnByValue: true,
  });

  console.log("Backend prototype methods:", JSON.stringify(protoResult.result.value, null, 2));

  // 5. Look for service locator patterns
  console.log("\n=== Service Locator Patterns ===\n");

  const locatorResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga) return { error: "No GoogleAccount" };

        const results = {};

        // Check for lazy service getters
        if (ga.services) {
          results.services = Object.keys(ga.services);
        }

        // Check for modules
        if (ga.modules) {
          results.modules = Object.keys(ga.modules);
        }

        // Check for features/flags
        if (ga.features) {
          results.features = Object.keys(ga.features).filter(f =>
            f.toLowerCase().includes('ai') ||
            f.toLowerCase().includes('assist') ||
            f.toLowerCase().includes('smart')
          );
        }

        // Check for account-level AI settings
        if (ga.account) {
          const acctKeys = Object.keys(ga.account);
          results.accountAiKeys = acctKeys.filter(k =>
            k.toLowerCase().includes('ai') ||
            k.toLowerCase().includes('assist') ||
            k.toLowerCase().includes('smart')
          );
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("Service locators:", JSON.stringify(locatorResult.result.value, null, 2));

  // 6. Check for GraphQL schema or operations
  console.log("\n=== GraphQL/Apollo Exploration ===\n");

  const gqlResult = await Runtime.evaluate({
    expression: `
      (() => {
        // Check for Apollo Client
        if (window.__APOLLO_CLIENT__) {
          const cache = window.__APOLLO_CLIENT__.cache;
          return {
            hasApollo: true,
            cacheType: typeof cache,
          };
        }

        // Check for other GraphQL patterns
        const ga = window.GoogleAccount;
        if (!ga) return { hasApollo: false };

        const gqlKeys = [];
        for (const key of Object.keys(ga)) {
          if (key.toLowerCase().includes('graph') || key.toLowerCase().includes('query') || key.toLowerCase().includes('mutation')) {
            gqlKeys.push(key);
          }
        }

        return { hasApollo: false, gqlKeys };
      })()
    `,
    returnByValue: true,
  });

  console.log("GraphQL:", JSON.stringify(gqlResult.result.value, null, 2));

  // 7. Monitor for AI-related network traffic
  console.log("\n=== Now monitoring ALL superhuman.com requests ===");
  console.log("Use 'Ask AI' in Superhuman to see the API calls.\n");

  Network.requestWillBeSent((params) => {
    const url = params.request.url;

    if (url.includes("superhuman.com")) {
      console.log("\n--- Request ---");
      console.log("URL:", url);
      console.log("Method:", params.request.method);

      if (params.request.postData) {
        try {
          const body = JSON.parse(params.request.postData);
          console.log("Body:", JSON.stringify(body, null, 2));
        } catch {
          console.log("Body (raw):", params.request.postData.substring(0, 500));
        }
      }
    }
  });

  // Keep running
  await new Promise(() => {});
}

main().catch(console.error);
