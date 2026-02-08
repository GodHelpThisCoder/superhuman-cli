/**
 * Try to call Superhuman's internal ID generator
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Look for global ID generation functions
        const ga = window.GoogleAccount;
        const di = ga?.di;

        // Try to find the analytics service which might have event ID generation
        try {
          // Look for any function that might generate IDs
          const accountStore = ga?.accountStore;
          if (accountStore) {
            results.accountStoreKeys = Object.keys(accountStore).slice(0, 20);
          }

          // Check the backend object for ID-related methods
          const backend = ga?.backend;
          if (backend) {
            const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(backend)).filter(n => n !== 'constructor');
            results.backendMethods = methods;
          }

          // Look for utils or helpers
          if (di?._services) {
            const utilServices = Object.keys(di._services).filter(k =>
              k.toLowerCase().includes('util') ||
              k.toLowerCase().includes('helper') ||
              k.toLowerCase().includes('generator') ||
              k.toLowerCase().includes('random')
            );
            results.utilServices = utilServices;
          }

          // Try to find shortId or similar
          try {
            const shortId = di.get('shortId');
            if (shortId) {
              results.shortId = typeof shortId === 'function' ? shortId() : 'exists';
            }
          } catch {}

          // Look for crypto utilities
          if (window.crypto?.randomUUID) {
            results.cryptoAvailable = true;
          }

        } catch (e) {
          results.error = e.message;
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));

  // Now try to find and call any available ID generators
  const idGenResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const results = [];

        // Search for generateId, shortId, or similar in the global scope
        for (const key of Object.keys(window)) {
          if (key.toLowerCase().includes('id') && typeof window[key] === 'function') {
            try {
              const sample = window[key]();
              if (typeof sample === 'string' && sample.length > 5 && sample.length < 30) {
                results.push({ fn: key, sample });
              }
            } catch {}
          }
        }

        // Also search in common places
        const places = [
          ga,
          ga?.backend,
          ga?.accountStore,
        ];

        for (const obj of places) {
          if (!obj) continue;
          for (const key of Object.keys(obj)) {
            if (key.toLowerCase().includes('id') && typeof obj[key] === 'function') {
              try {
                const sample = obj[key]();
                if (typeof sample === 'string' && sample.length > 5) {
                  results.push({ source: 'ga', fn: key, sample: sample.substring(0, 30) });
                }
              } catch {}
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("\nID generators found:", JSON.stringify(idGenResult.result.value, null, 2));

  await disconnect(conn);
}
main();
