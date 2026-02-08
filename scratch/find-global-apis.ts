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

        // Check what's in GoogleAccount directly
        const gaKeys = ga ? Object.keys(ga).filter(k => !k.startsWith("_")) : [];

        // Check the di container structure
        const di = ga?.di;
        const diStructure = di ? {
          keys: Object.keys(di),
          hasProviders: !!di._providers,
          providerType: di._providers ? typeof di._providers : null,
          isMap: di._providers instanceof Map,
        } : null;

        // Try to find the API client directly
        let apiClient = null;
        if (di) {
          // Try common patterns
          const tryGet = (name) => {
            try { return di.get(name); } catch { return null; }
          };

          const possibleNames = ["api", "http", "client", "apiClient", "userdataApi", "backendApi"];
          for (const name of possibleNames) {
            const svc = tryGet(name);
            if (svc) {
              apiClient = {
                name,
                methods: Object.keys(svc).filter(k => typeof svc[k] === "function").slice(0, 20)
              };
              break;
            }
          }
        }

        // Check for fetch interceptor or API module
        const hasFetchInterceptor = !!window.__superhuman_fetch;

        // Look for any write-related functions on GoogleAccount
        const gaWriteMethods = ga ? Object.keys(ga).filter(k =>
          typeof ga[k] === "function" &&
          (k.includes("write") || k.includes("Write") || k.includes("save") || k.includes("Save"))
        ) : [];

        return {
          gaKeys: gaKeys.slice(0, 30),
          diStructure,
          apiClient,
          hasFetchInterceptor,
          gaWriteMethods
        };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

main();
