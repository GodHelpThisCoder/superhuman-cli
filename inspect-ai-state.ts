/**
 * Inspect Superhuman's internal state to find AI session/event IDs
 */

import WebSocket from "ws";

const CDP_URL = "http://localhost:9333";

async function getSuperhuman() {
  const response = await fetch(`${CDP_URL}/json`);
  const targets: any[] = await response.json();
  return targets.find(t =>
    t.url.includes("mail.superhuman.com") &&
    !t.url.includes("background") &&
    t.webSocketDebuggerUrl
  );
}

async function inspectState() {
  console.log("=== Inspecting Superhuman AI State ===\n");

  const target = await getSuperhuman();
  if (!target) {
    console.error("Superhuman not found");
    process.exit(1);
  }

  console.log(`Connected to: ${target.title}\n`);

  const ws = new WebSocket(target.webSocketDebuggerUrl!);
  let msgId = 0;

  const evaluate = (expression: string): Promise<any> => {
    return new Promise((resolve) => {
      const id = ++msgId;
      const handler = (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.off("message", handler);
          resolve(msg.result?.result?.value);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: {
          expression,
          returnByValue: true,
          awaitPromise: true
        }
      }));
    });
  };

  ws.on("open", async () => {
    // 1. Check localStorage for AI-related keys
    console.log("=== localStorage ===\n");
    const localStorage = await evaluate(`
      (function() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (
            key.toLowerCase().includes('ai') ||
            key.toLowerCase().includes('session') ||
            key.toLowerCase().includes('event') ||
            key.toLowerCase().includes('agent') ||
            key.toLowerCase().includes('question') ||
            key.toLowerCase().includes('thread')
          )) {
            const val = localStorage.getItem(key);
            try {
              data[key] = JSON.parse(val);
            } catch {
              data[key] = val;
            }
          }
        }
        return JSON.stringify(data, null, 2);
      })()
    `);
    console.log(localStorage || "No AI-related localStorage found\n");

    // 2. Look for global objects that might contain AI state
    console.log("\n=== Global AI State ===\n");
    const globalState = await evaluate(`
      (function() {
        const results = {};

        // Check window properties
        for (const key of Object.keys(window)) {
          if (key.toLowerCase().includes('ai') ||
              key.toLowerCase().includes('agent') ||
              key.toLowerCase().includes('ask')) {
            try {
              results['window.' + key] = typeof window[key];
            } catch {}
          }
        }

        // Check for common state management
        if (window.__REDUX_DEVTOOLS_EXTENSION__) {
          results.hasRedux = true;
        }

        // Check for React DevTools
        if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
          results.hasReact = true;
        }

        // Check for Superhuman-specific globals
        if (window.Superhuman) {
          results.superhumanGlobal = Object.keys(window.Superhuman);
        }

        return JSON.stringify(results, null, 2);
      })()
    `);
    console.log(globalState || "No global AI state found\n");

    // 3. Try to find React fiber roots and extract state
    console.log("\n=== React Component State (AskAI) ===\n");
    const reactState = await evaluate(`
      (function() {
        // Find React root
        const rootElement = document.getElementById('root') || document.querySelector('[data-reactroot]');
        if (!rootElement) return 'No React root found';

        // Try to find the fiber
        const fiberKey = Object.keys(rootElement).find(key => key.startsWith('__reactFiber'));
        if (!fiberKey) return 'No React fiber found';

        const fiber = rootElement[fiberKey];

        // Walk the fiber tree looking for AI-related state
        const aiData = [];
        let current = fiber;
        let depth = 0;
        const maxDepth = 100;

        function extractAIData(node, path = '') {
          if (!node || depth++ > maxDepth) return;

          // Check memoizedState for AI-related data
          if (node.memoizedState) {
            const stateStr = JSON.stringify(node.memoizedState);
            if (stateStr && (
              stateStr.includes('question_event_id') ||
              stateStr.includes('session_id') ||
              stateStr.includes('agent_session') ||
              stateStr.includes('askAI')
            )) {
              aiData.push({
                path,
                state: node.memoizedState
              });
            }
          }

          // Check pendingProps
          if (node.pendingProps) {
            const propsStr = JSON.stringify(node.pendingProps);
            if (propsStr && propsStr.includes('question_event_id')) {
              aiData.push({
                path: path + '.props',
                props: node.pendingProps
              });
            }
          }

          // Recurse
          if (node.child) extractAIData(node.child, path + '.child');
          if (node.sibling) extractAIData(node.sibling, path + '.sibling');
        }

        extractAIData(fiber, 'root');
        return JSON.stringify(aiData.slice(0, 5), null, 2);
      })()
    `);
    console.log(reactState || "No React AI state found\n");

    // 4. Check for IndexedDB data
    console.log("\n=== IndexedDB Databases ===\n");
    const idbData = await evaluate(`
      (async function() {
        try {
          const dbs = await indexedDB.databases();
          return JSON.stringify(dbs, null, 2);
        } catch (e) {
          return 'IndexedDB.databases() not supported: ' + e.message;
        }
      })()
    `);
    console.log(idbData || "No IndexedDB data\n");

    // 5. Look for performance entries (network requests)
    console.log("\n=== Recent Network Requests (AI-related) ===\n");
    const perfEntries = await evaluate(`
      (function() {
        const entries = performance.getEntriesByType('resource');
        const aiEntries = entries.filter(e =>
          e.name.includes('ai.') ||
          e.name.includes('askAI') ||
          e.name.includes('agent') ||
          e.name.includes('question')
        ).map(e => ({
          name: e.name,
          startTime: e.startTime,
          duration: e.duration
        }));
        return JSON.stringify(aiEntries.slice(-20), null, 2);
      })()
    `);
    console.log(perfEntries || "No AI-related performance entries\n");

    // 6. Try to find any XHR/fetch interceptors that might have cached data
    console.log("\n=== Looking for cached request data ===\n");
    const cachedRequests = await evaluate(`
      (function() {
        // Check if there's a request cache
        const caches = [];

        // Common caching patterns
        if (window.__requestCache) caches.push('__requestCache');
        if (window.__apiCache) caches.push('__apiCache');
        if (window.cacheStore) caches.push('cacheStore');

        // Check for Apollo cache
        if (window.__APOLLO_CLIENT__) {
          try {
            const cache = window.__APOLLO_CLIENT__.cache.extract();
            const aiKeys = Object.keys(cache).filter(k =>
              k.includes('AI') || k.includes('Ask') || k.includes('question')
            );
            if (aiKeys.length > 0) {
              return JSON.stringify({
                type: 'Apollo',
                aiKeys,
                samples: aiKeys.slice(0, 3).map(k => ({ key: k, value: cache[k] }))
              }, null, 2);
            }
          } catch {}
        }

        return JSON.stringify({ foundCaches: caches }, null, 2);
      })()
    `);
    console.log(cachedRequests || "No cached requests found\n");

    // 7. Search all localStorage and sessionStorage for anything with "event" or "session"
    console.log("\n=== All Storage with 'event' or 'session' ===\n");
    const allStorage = await evaluate(`
      (function() {
        const data = {};

        // localStorage
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const val = localStorage.getItem(key);
          if (val && (val.includes('event_id') || val.includes('session_id'))) {
            try {
              data['localStorage.' + key] = JSON.parse(val);
            } catch {
              data['localStorage.' + key] = val.slice(0, 200);
            }
          }
        }

        // sessionStorage
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          const val = sessionStorage.getItem(key);
          if (val && (val.includes('event_id') || val.includes('session_id'))) {
            try {
              data['sessionStorage.' + key] = JSON.parse(val);
            } catch {
              data['sessionStorage.' + key] = val.slice(0, 200);
            }
          }
        }

        return JSON.stringify(data, null, 2);
      })()
    `);
    console.log(allStorage || "No storage with event/session IDs\n");

    // 8. Check for service worker caches
    console.log("\n=== Service Worker Caches ===\n");
    const swCaches = await evaluate(`
      (async function() {
        try {
          const cacheNames = await caches.keys();
          const results = {};
          for (const name of cacheNames) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            const aiKeys = keys.filter(req =>
              req.url.includes('ai') || req.url.includes('ask')
            ).map(req => req.url);
            if (aiKeys.length > 0) {
              results[name] = aiKeys;
            }
          }
          return JSON.stringify({
            cacheNames,
            aiRelated: results
          }, null, 2);
        } catch (e) {
          return 'Error: ' + e.message;
        }
      })()
    `);
    console.log(swCaches || "No SW caches\n");

    ws.close();
  });
}

inspectState().catch(console.error);
