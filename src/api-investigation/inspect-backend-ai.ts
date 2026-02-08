/**
 * Inspect backend AI methods and try to create a session/event
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime } = conn;

  // First, let's look at the function signatures of AI methods
  const inspectResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const backend = ga?.backend;

        if (!backend) return { error: 'No backend' };

        // Get function source for key AI methods
        const methods = {};

        const aiMethodNames = [
          'amendAgentSessionEvent',
          'discardAgentSession',
          'restoreAgentSession',
          'setAgentSessionMetadata',
          'semanticSearch',
        ];

        for (const name of aiMethodNames) {
          const fn = backend[name];
          if (fn) {
            // Get first 500 chars of function source
            methods[name] = fn.toString().slice(0, 500);
          }
        }

        return { methods };
      })()
    `,
    returnByValue: true,
  });

  console.log("AI method sources:");
  const methods = inspectResult.result.value?.methods || {};
  for (const [name, source] of Object.entries(methods)) {
    console.log(`\n=== ${name} ===`);
    console.log(source);
  }

  // Look for any ID generation utilities
  const idGenResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;

        // Search for ID generators in various places
        const results = {};

        // Check accountStore for any ID methods
        const accountStore = ga?.accountStore;
        if (accountStore) {
          const keys = Object.keys(accountStore).filter(k =>
            k.toLowerCase().includes('id') ||
            k.toLowerCase().includes('event') ||
            k.toLowerCase().includes('generate')
          );
          results.accountStoreIdKeys = keys;
        }

        // Check if there's an eventId or shortId in the global state
        try {
          const state = accountStore?.state;
          if (state) {
            results.stateKeys = Object.keys(state).slice(0, 30);
          }
        } catch {}

        // Look for any exports from the app's modules
        // Check window for any ID-related functions
        const windowIdFunctions = Object.keys(window).filter(k =>
          (k.toLowerCase().includes('id') || k.toLowerCase().includes('event')) &&
          typeof window[k] === 'function'
        );
        results.windowIdFunctions = windowIdFunctions;

        // Check for ShortId module
        try {
          const modules = ga?._modules || {};
          results.moduleNames = Object.keys(modules).slice(0, 30);
        } catch {}

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("\n\nID generation utilities:");
  console.log(JSON.stringify(idGenResult.result.value, null, 2));

  // Now look at what pseudoTeamId format tells us
  const teamIdResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const settings = ga?.accountStore?.state?.account?.settings;
        const pseudoTeamId = settings?._cache?.pseudoTeamId;

        // Extract the ID pattern (looks like team_11...)
        return {
          pseudoTeamId,
          idPrefix: pseudoTeamId?.match(/\\d+/)?.[0],
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n\nTeam ID info:");
  console.log(JSON.stringify(teamIdResult.result.value, null, 2));

  // Try to find the actual ShortId/event ID generator
  const shortIdResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        // List all private properties of di that might be services
        const diPrivate = {};
        for (const key of Object.getOwnPropertyNames(di)) {
          if (key.startsWith('_')) {
            const val = di[key];
            if (typeof val === 'object' && val !== null) {
              diPrivate[key] = Object.keys(val).slice(0, 20);
            }
          }
        }

        return { diPrivate };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n\nDI private services:");
  console.log(JSON.stringify(shortIdResult.result.value, null, 2));

  // Try calling restoreAgentSession with empty/null to see what it expects
  const tryRestoreResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const backend = ga?.backend;

        try {
          // Look at what restoreAgentSession expects
          const result = await backend.restoreAgentSession({ agent_session_id: null });
          return { result };
        } catch (e) {
          return { error: e.message, stack: e.stack?.slice(0, 500) };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("\n\nrestoreAgentSession attempt:");
  console.log(JSON.stringify(tryRestoreResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
