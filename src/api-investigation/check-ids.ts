/**
 * Check Superhuman's ID structure
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

        // Get all string IDs from GoogleAccount
        const allIds = {};
        for (const key of Object.keys(ga || {})) {
          const val = ga[key];
          if (typeof val === 'string' && val.length > 5 && val.length < 50) {
            allIds[key] = val;
          }
        }

        // Try to find ID generator
        let genId = null;
        try {
          // Look for common ID generation patterns
          if (di) {
            const idGen = di.get('idGenerator') || di.get('IdGenerator') || di.get('eventIdGenerator');
            if (idGen && typeof idGen === 'function') {
              genId = idGen();
            }
          }
        } catch {}

        // Check if there's an event tracking or analytics object
        let analyticsIds = {};
        try {
          const analytics = di?.get('analytics');
          if (analytics) {
            analyticsIds = { type: typeof analytics, keys: Object.keys(analytics).slice(0, 10) };
          }
        } catch {}

        return {
          allIds,
          genId,
          analyticsIds,
        };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}
main();
