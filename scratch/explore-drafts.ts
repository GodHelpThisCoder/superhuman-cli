import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const { Runtime } = conn;

  // Check for draft-related services in DI container
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        if (!di) return { error: "No DI container" };

        // Try to find all registered service names
        const registeredServices = [];
        if (di._registry) {
          registeredServices.push(...Object.keys(di._registry).slice(0, 50));
        }
        if (di._instances) {
          registeredServices.push(...Object.keys(di._instances).slice(0, 50));
        }

        // Filter for draft-related
        const draftRelated = registeredServices.filter(name =>
          name.toLowerCase().includes('draft') ||
          name.toLowerCase().includes('compose') ||
          name.toLowerCase().includes('message')
        );

        // Check for IndexedDB usage
        const hasIndexedDB = typeof indexedDB !== 'undefined';

        // Check localStorage for drafts
        const localStorageKeys = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.includes('draft') || key.includes('compose'))) {
              localStorageKeys.push(key);
            }
          }
        } catch {}

        return {
          draftRelated: [...new Set(draftRelated)],
          allServices: [...new Set(registeredServices)].slice(0, 100),
          hasIndexedDB,
          localStorageKeys
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("Draft investigation:", JSON.stringify(result.result.value, null, 2));

  // Also check what _saveDraftAsync actually does
  const saveResult = await Runtime.evaluate({
    expression: `
      (() => {
        // Find any compose controller
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "No compose controllers" };

        const keys = Object.keys(cfc);
        if (keys.length === 0) return { error: "No active compose" };

        const ctrl = cfc[keys[0]];

        // Check what methods exist on the controller
        const methods = Object.keys(ctrl).filter(k => typeof ctrl[k] === 'function');

        // Check the draft object structure
        const draft = ctrl?.state?.draft;
        const draftKeys = draft ? Object.keys(draft) : [];

        return {
          controllerMethods: methods,
          draftKeys,
          draftType: draft?.constructor?.name
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("Compose controller:", JSON.stringify(saveResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
