import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        // List ALL providers/services
        const allProviders = [];
        if (di?._providers) {
          for (const [name] of di._providers) {
            allProviders.push(name);
          }
        }

        // Look for any service with 'write' in its methods
        const writeServices = [];
        for (const name of allProviders) {
          try {
            const svc = di.get(name);
            if (svc) {
              const writeMethods = Object.keys(svc).filter(k =>
                typeof svc[k] === "function" &&
                k.toLowerCase().includes("write")
              );
              if (writeMethods.length > 0) {
                writeServices.push({ name, methods: writeMethods });
              }
            }
          } catch {}
        }

        // Also check for API/HTTP related services
        const apiServices = [];
        for (const name of allProviders) {
          if (name.toLowerCase().includes("api") ||
              name.toLowerCase().includes("http") ||
              name.toLowerCase().includes("backend") ||
              name.toLowerCase().includes("userdata")) {
            try {
              const svc = di.get(name);
              if (svc) {
                apiServices.push({
                  name,
                  methods: Object.keys(svc).filter(k => typeof svc[k] === "function").slice(0, 20)
                });
              }
            } catch {}
          }
        }

        return {
          totalProviders: allProviders.length,
          providerNames: allProviders.slice(0, 50),
          writeServices,
          apiServices
        };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

main();
