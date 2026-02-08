/**
 * Explore the DI container structure
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        if (!di) {
          return { error: 'No DI found', gaKeys: ga ? Object.keys(ga) : null };
        }

        // Get DI structure
        const diKeys = Object.keys(di);
        const diMethods = Object.keys(di).filter(k => typeof di[k] === 'function');

        // Try to call 'get' with some names
        const tryGet = (name) => {
          try {
            const svc = di.get(name);
            return svc ? (typeof svc === 'function' ? 'function' : Object.keys(svc).slice(0, 10)) : null;
          } catch (e) {
            return 'error: ' + e.message;
          }
        };

        return {
          diKeys,
          diMethods,
          tryBackend: tryGet('backend'),
          tryAI: tryGet('ai'),
          tryGmail: tryGet('gmail'),
          tryMsgraph: tryGet('msgraph'),
          tryShortId: tryGet('shortId'),
          tryIdGen: tryGet('idGen'),
        };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));

  // Now let's look at the backend methods specifically
  const backendResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const backend = ga?.backend;

        if (!backend) return { error: 'No backend' };

        // Get ALL methods
        const proto = Object.getPrototypeOf(backend);
        const methods = Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor');

        // Filter for AI/agent related
        const aiMethods = methods.filter(m =>
          m.toLowerCase().includes('ai') ||
          m.toLowerCase().includes('agent') ||
          m.toLowerCase().includes('session') ||
          m.toLowerCase().includes('event')
        );

        return { aiMethods, allMethods: methods.slice(0, 100) };
      })()
    `,
    returnByValue: true,
  });

  console.log("\nBackend methods:", JSON.stringify(backendResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
