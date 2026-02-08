/**
 * Find Superhuman's ID generation
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

        if (!di) return { error: 'no di' };

        // Look for event ID related services
        const keys = Object.keys(di._services || {}).filter(k =>
          k.toLowerCase().includes('event') ||
          k.toLowerCase().includes('analytics') ||
          k.toLowerCase().includes('id')
        );

        // Try to get idGen
        let idGenExample = null;
        try {
          const idGen = di.get('idGen');
          if (idGen) {
            idGenExample = typeof idGen === 'function' ? idGen() : (idGen.generate ? idGen.generate() : String(idGen));
          }
        } catch {}

        // Also look at the team/account ID
        const teamId = ga?.teamId || ga?.team?.id;
        const accountId = ga?.accountId;

        return { keys, idGenExample, teamId, accountId };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}
main();
