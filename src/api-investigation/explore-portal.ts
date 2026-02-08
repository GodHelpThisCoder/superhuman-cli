/**
 * Explore the portal service - this seems to be where agentSessions delegates to
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime } = conn;

  console.log("=== Explore portal service ===\n");

  const portalResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        try {
          const portal = di?.get?.('portal');
          if (!portal) return { error: 'No portal service' };

          return {
            type: typeof portal,
            keys: Object.keys(portal),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(portal)).filter(n => n !== 'constructor'),
            // Check for internal methods
            internalKeys: portal._internal ? Object.keys(portal._internal) : null,
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("portal service:");
  console.log(JSON.stringify(portalResult.result.value, null, 2));

  console.log("\n=== Try to list services in agentSessionsInternal ===\n");

  // Try to invoke portal to get agentSessionsInternal
  const agentInternalResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const portal = di?.get?.('portal');

        if (!portal) return { error: 'No portal' };

        // Try to see what agentSessionsInternal exposes
        try {
          // Get existing sessions to understand the ID format
          const sessions = await portal.invoke('agentSessionsInternal', 'getAllSessions', []);
          return {
            sessionCount: sessions?.length,
            sampleSessions: sessions?.slice(0, 3),
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("agentSessionsInternal sessions:");
  console.log(JSON.stringify(agentInternalResult.result.value, null, 2));

  console.log("\n=== Check viewState for any stored event IDs ===\n");

  const viewStateResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        try {
          const viewState = di?.get?.('viewState');
          if (!viewState) return { error: 'No viewState' };

          // Look at the tree structure
          const tree = viewState.tree;
          if (!tree) return { error: 'No tree in viewState' };

          // Get sidebarAIAgent state
          const aiAgentState = tree.get(['sidebarAIAgent']);

          return {
            aiAgentState,
            treeKeys: tree._root ? Object.keys(tree._root) : null,
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("viewState AI agent state:");
  console.log(JSON.stringify(viewStateResult.result.value, null, 2));

  console.log("\n=== Check if there's a shortId utility somewhere ===\n");

  // Search for shortid in the entire window object more thoroughly
  const deepSearchResult = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Search for any property containing 'short', 'push', 'event', 'cuid'
        function deepSearch(obj, path, depth = 0, seen = new WeakSet()) {
          if (depth > 6 || !obj || typeof obj !== 'object') return;
          if (seen.has(obj)) return;
          seen.add(obj);

          try {
            for (const key of Object.keys(obj)) {
              const lowerKey = key.toLowerCase();
              if (lowerKey.includes('shortid') ||
                  lowerKey.includes('pushid') ||
                  lowerKey.includes('eventid') ||
                  lowerKey.includes('cuid') ||
                  lowerKey.includes('nanoid') ||
                  lowerKey.includes('genid') ||
                  lowerKey.includes('makeid') ||
                  lowerKey.includes('uniqueid')) {
                const val = obj[key];
                results[path + '.' + key] = {
                  type: typeof val,
                  sample: typeof val === 'function' ? 'function' : (typeof val === 'string' ? val.slice(0, 30) : null)
                };
              }

              // Recurse into objects but not too deep
              if (typeof obj[key] === 'object' && obj[key] !== null && depth < 4) {
                deepSearch(obj[key], path + '.' + key, depth + 1, seen);
              }
            }
          } catch {}
        }

        const ga = window.GoogleAccount;
        deepSearch(ga, 'ga');
        deepSearch(window, 'window', 0, new WeakSet());

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("Deep search for ID generators:");
  console.log(JSON.stringify(deepSearchResult.result.value, null, 2));

  console.log("\n=== Check the Re.a.get() method that generates session IDs ===\n");

  // In the discardSession method, I saw: sessionId: Re.a.get()
  // This might be the session ID generator
  const reAResult = await Runtime.evaluate({
    expression: `
      (() => {
        // Try to find Re.a in the global scope
        // This is minified code, so we need to find the module

        const ga = window.GoogleAccount;
        const results = {};

        // Look for anything that looks like a session/ID generator
        // in the backend's prototype chain
        const backend = ga?.backend;
        if (backend) {
          const proto = Object.getPrototypeOf(backend);
          for (const method of Object.getOwnPropertyNames(proto)) {
            const fn = backend[method];
            if (typeof fn === 'function') {
              const src = fn.toString();
              // Look for patterns like Re.a.get() or similar ID getters
              if (src.includes('.get()') && (src.includes('sessionId') || src.includes('eventId'))) {
                results[method] = src.slice(0, 400);
              }
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("Methods using .get() for IDs:");
  console.log(JSON.stringify(reAResult.result.value, null, 2));

  console.log("\n=== Try to directly invoke the AI compose and capture the ID ===\n");

  // Set up interceptor to capture the exact moment an event ID is used
  await Runtime.evaluate({
    expression: `
      (function() {
        // Patch aiComposeEdit to log the questionEventId parameter
        const ga = window.GoogleAccount;
        const backend = ga?.backend;

        if (!backend || window._aiPatchInstalled) return 'Already patched or no backend';

        window._aiPatchInstalled = true;
        window._capturedQuestionEventIds = [];

        const original = backend.aiComposeEdit.bind(backend);
        backend.aiComposeEdit = async function(params) {
          window._capturedQuestionEventIds.push({
            timestamp: Date.now(),
            questionEventId: params.questionEventId,
            sessionId: params.sessionId,
          });
          console.log('[AI COMPOSE EDIT]', params.questionEventId, params.sessionId);
          return original(params);
        };

        const originalAgentic = backend.aiComposeAgentic.bind(backend);
        backend.aiComposeAgentic = async function(params) {
          window._capturedQuestionEventIds.push({
            timestamp: Date.now(),
            questionEventId: params.questionEventId,
            sessionId: params.sessionId,
            type: 'agentic'
          });
          console.log('[AI COMPOSE AGENTIC]', params.questionEventId, params.sessionId);
          return originalAgentic(params);
        };

        return 'AI methods patched';
      })()
    `,
  });

  console.log("AI methods patched. Use Ask AI in Superhuman and then run this script again to see captured IDs.");

  console.log("\n=== Check for any captured IDs from previous runs ===\n");

  const capturedResult = await Runtime.evaluate({
    expression: `window._capturedQuestionEventIds || window._capturedEventIds || []`,
    returnByValue: true,
  });

  console.log("Previously captured event IDs:");
  console.log(JSON.stringify(capturedResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
