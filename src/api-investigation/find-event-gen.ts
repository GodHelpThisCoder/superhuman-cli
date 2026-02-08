/**
 * Find event ID generator in Superhuman
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        const results = {};

        // List all DI services
        if (di?._services) {
          results.allServices = Object.keys(di._services);
        }

        // Look for any ID generator functions
        if (di) {
          // Try common ID service names
          const idServiceNames = ['id', 'idGenerator', 'idGen', 'eventId', 'uniqueId', 'uuid'];
          for (const name of idServiceNames) {
            try {
              const svc = di.get(name);
              if (svc) {
                results[name] = typeof svc === 'function' ? 'function' : Object.keys(svc);
              }
            } catch {}
          }

          // Check analytics for event generation
          try {
            const analytics = di.get('analytics');
            if (analytics) {
              results.analyticsKeys = Object.keys(analytics);
            }
          } catch {}
        }

        // Check window for global ID generators
        const globalFns = [];
        for (const key of Object.keys(window)) {
          if (key.toLowerCase().includes('id') && typeof window[key] === 'function') {
            globalFns.push(key);
          }
        }
        results.globalIdFunctions = globalFns.slice(0, 20);

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}
main();
