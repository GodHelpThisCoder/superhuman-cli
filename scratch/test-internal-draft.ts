import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Try to find and invoke Superhuman's internal draft creation
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          // List all services that might have draft-related methods
          const allServices = [];
          if (di?._providers) {
            for (const [name] of di._providers) {
              try {
                const svc = di.get(name);
                if (svc) {
                  const draftMethods = Object.keys(svc).filter(k =>
                    typeof svc[k] === 'function' &&
                    (k.toLowerCase().includes('draft') || k.toLowerCase().includes('compose') || k.toLowerCase().includes('write'))
                  );
                  if (draftMethods.length > 0) {
                    allServices.push({ service: name, methods: draftMethods });
                  }
                }
              } catch {}
            }
          }

          return { servicesWithDraftMethods: allServices };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

main();
