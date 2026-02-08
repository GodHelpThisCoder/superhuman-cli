/**
 * Check for cached AI requests and global state via CDP
 */
import WebSocket from "ws";

const CDP_URL = "http://localhost:9333";

async function main() {
  const response = await fetch(CDP_URL + "/json");
  const targets = await response.json() as any[];

  const superhuman = targets.find(t =>
    t.url.includes("mail.superhuman.com") &&
    t.url.indexOf("background") === -1 &&
    t.webSocketDebuggerUrl
  );

  if (!superhuman) {
    console.log("Superhuman not found");
    process.exit(1);
  }

  console.log("Target:", superhuman.title);
  console.log("URL:", superhuman.url);

  const ws = new WebSocket(superhuman.webSocketDebuggerUrl);
  let msgId = 0;

  const send = (method: string, params: any = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      const timeout = setTimeout(() => {
        ws.off("message", handler);
        resolve(null); // Don't reject, just return null
      }, 10000);

      const handler = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.off("message", handler);
          resolve(msg.result);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  ws.on("open", async () => {
    console.log("\nConnected to CDP\n");

    // Enable Network
    await send("Network.enable");
    console.log("Network enabled");

    // Check for AI request history in window.__capturedAIRequests
    console.log("\n=== Checking window.__capturedAIRequests ===");
    const result1 = await send("Runtime.evaluate", {
      expression: 'JSON.stringify(window.__capturedAIRequests || "not found")',
      returnByValue: true
    });
    console.log("__capturedAIRequests:", result1?.result?.value?.slice(0, 1000));

    // Look for performance entries
    console.log("\n=== Checking Performance Entries for AI requests ===");
    const perfExpr = `
      (function() {
        const perfEntries = performance.getEntriesByType("resource")
          .filter(e => e.name.includes("askAI") || e.name.includes("/ai.") || e.name.includes("agent") || e.name.includes("question"))
          .map(e => ({name: e.name, duration: e.duration}));
        return JSON.stringify(perfEntries, null, 2);
      })()
    `;

    const result2 = await send("Runtime.evaluate", {
      expression: perfExpr,
      returnByValue: true
    });
    console.log("Performance entries:", result2?.result?.value);

    // Check Cache Storage
    console.log("\n=== Checking Cache Storage for AI requests ===");
    const cacheExpr = `
      (async function() {
        try {
          const cacheNames = await caches.keys();
          const aiCaches = [];
          for (const name of cacheNames) {
            const cache = await caches.open(name);
            const requests = await cache.keys();
            const aiRequests = requests.filter(r =>
              r.url.includes("askAI") ||
              r.url.includes("/ai.") ||
              r.url.includes("agent")
            );
            if (aiRequests.length > 0) {
              aiCaches.push({
                cacheName: name,
                requests: aiRequests.map(r => r.url)
              });
            }
          }
          return JSON.stringify(aiCaches, null, 2);
        } catch (e) {
          return JSON.stringify({error: e.message});
        }
      })()
    `;

    const result3 = await send("Runtime.evaluate", {
      expression: cacheExpr,
      awaitPromise: true,
      returnByValue: true
    });
    console.log("Cache result:", result3?.result?.value);

    // Check IndexedDB databases
    console.log("\n=== Checking IndexedDB databases ===");
    const idbListExpr = `
      (async function() {
        try {
          const dbs = await indexedDB.databases();
          return JSON.stringify(dbs, null, 2);
        } catch (e) {
          return JSON.stringify({error: e.message});
        }
      })()
    `;

    const result4 = await send("Runtime.evaluate", {
      expression: idbListExpr,
      awaitPromise: true,
      returnByValue: true
    });
    console.log("IndexedDB databases:", result4?.result?.value);

    // Look for any recent network requests that might be cached
    console.log("\n=== Looking at all performance resource entries ===");
    const allPerfExpr = `
      (function() {
        const entries = performance.getEntriesByType("resource")
          .filter(e => e.name.includes("superhuman"))
          .slice(-50)
          .map(e => e.name);
        return JSON.stringify(entries, null, 2);
      })()
    `;

    const result5 = await send("Runtime.evaluate", {
      expression: allPerfExpr,
      returnByValue: true
    });
    console.log("Recent superhuman resource entries:", result5?.result?.value?.slice(0, 3000));

    // Check for global __REDUX_DEVTOOLS_EXTENSION__ state
    console.log("\n=== Checking for Redux state ===");
    const reduxExpr = `
      (function() {
        try {
          if (window.__REDUX_DEVTOOLS_EXTENSION__) {
            return "Redux DevTools available";
          }
          // Try to find store
          const possibleStores = ['store', '__store__', 'reduxStore', '__STORE__'];
          for (const name of possibleStores) {
            if (window[name] && typeof window[name].getState === 'function') {
              const state = window[name].getState();
              // Look for AI-related keys
              const keys = Object.keys(state);
              const aiKeys = keys.filter(k =>
                k.toLowerCase().includes('ai') ||
                k.toLowerCase().includes('ask') ||
                k.toLowerCase().includes('agent')
              );
              if (aiKeys.length > 0) {
                return JSON.stringify({store: name, aiKeys, preview: aiKeys.map(k => ({key: k, value: JSON.stringify(state[k]).slice(0, 200)}))});
              }
            }
          }
          return "No store found";
        } catch (e) {
          return JSON.stringify({error: e.message});
        }
      })()
    `;

    const result6 = await send("Runtime.evaluate", {
      expression: reduxExpr,
      returnByValue: true
    });
    console.log("Redux state:", result6?.result?.value);

    ws.close();
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    process.exit(1);
  });
}

main();
