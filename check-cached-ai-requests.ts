/**
 * Check for cached AI requests and global state in Superhuman
 *
 * This script:
 * 1. Enables Network.enable() to capture ongoing requests
 * 2. Checks for window._capturedAICalls or similar global state
 * 3. Looks for localStorage/sessionStorage data related to AI
 */

import WebSocket from "ws";

const CDP_URL = "http://localhost:9333";

interface CDPTarget {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

async function getSuperhuman(): Promise<CDPTarget | null> {
  const response = await fetch(`${CDP_URL}/json`);
  const targets: CDPTarget[] = await response.json();

  // Find Superhuman main window
  const superhuman = targets.find(t =>
    t.url.includes("mail.superhuman.com") &&
    !t.url.includes("background") &&
    t.webSocketDebuggerUrl
  );

  return superhuman || null;
}

async function checkCachedRequests() {
  console.log("=== Checking for Cached AI Requests ===\n");

  const target = await getSuperhuman();
  if (!target) {
    console.error("Superhuman not found. Make sure it's running with --remote-debugging-port=9333");
    process.exit(1);
  }

  console.log(`Connected to: ${target.title}`);
  console.log(`URL: ${target.url}\n`);

  const ws = new WebSocket(target.webSocketDebuggerUrl!);
  let msgId = 0;

  const send = (method: string, params: any = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      const timeout = setTimeout(() => {
        ws.off("message", handler);
        reject(new Error(`Timeout waiting for response ${id}`));
      }, 10000);

      const handler = (data: Buffer) => {
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

  const capturedRequests: any[] = [];
  let networkEnabled = false;

  // Listen for network events
  ws.on("message", (data: Buffer) => {
    const msg = JSON.parse(data.toString());

    if (msg.method === "Network.requestWillBeSent") {
      const { requestId, request } = msg.params;
      const { url, method, postData } = request;

      // Check for AI-related requests
      if (url.includes("askAI") || url.includes("ai.superhuman") ||
          url.includes("agent") || url.includes("question")) {
        console.log(`\n[LIVE REQUEST] ${method} ${url}`);

        if (postData) {
          try {
            const body = JSON.parse(postData);
            console.log("Body:", JSON.stringify(body, null, 2));
            capturedRequests.push({ url, body, timestamp: new Date().toISOString() });
          } catch {
            console.log("Raw postData:", postData.slice(0, 500));
          }
        }
      }
    }

    if (msg.method === "Network.responseReceived") {
      const { response } = msg.params;
      if (response.url.includes("askAI") || response.url.includes("ai.superhuman")) {
        console.log(`\n[RESPONSE] ${response.status} ${response.url}`);
      }
    }
  });

  ws.on("open", async () => {
    console.log("CDP connection established\n");

    // 1. Enable Network monitoring
    console.log("1. Enabling Network domain...");
    try {
      await send("Network.enable", {});
      networkEnabled = true;
      console.log("   Network monitoring enabled\n");
    } catch (e: any) {
      console.log("   Failed to enable Network:", e.message);
    }

    // 2. Check for global AI state
    console.log("2. Checking for global AI state...\n");

    const globalChecks = [
      "window.__capturedAIRequests",
      "window.__capturedAICalls",
      "window._aiState",
      "window.aiState",
      "window.__askAI",
      "window.superhuman?.ai",
      "window.app?.ai",
      "window.store?.getState?.()?.ai",
    ];

    for (const check of globalChecks) {
      try {
        const result = await send("Runtime.evaluate", {
          expression: `JSON.stringify(${check} || null)`,
          returnByValue: true
        });

        const value = result?.result?.value;
        if (value && value !== "null") {
          console.log(`   ${check}: ${value.slice(0, 500)}`);
        }
      } catch {
        // Ignore errors
      }
    }

    // 3. Search for AI-related data in localStorage
    console.log("\n3. Checking localStorage for AI data...");
    try {
      const result = await send("Runtime.evaluate", {
        expression: `
          (function() {
            const found = {};
            const keys = Object.keys(localStorage);
            for (const key of keys) {
              if (key.toLowerCase().includes('ai') ||
                  key.toLowerCase().includes('session') ||
                  key.toLowerCase().includes('event') ||
                  key.toLowerCase().includes('question') ||
                  key.toLowerCase().includes('agent')) {
                try {
                  found[key] = JSON.parse(localStorage.getItem(key));
                } catch {
                  found[key] = localStorage.getItem(key);
                }
              }
            }
            return JSON.stringify(found, null, 2);
          })()
        `,
        returnByValue: true
      });

      const data = JSON.parse(result?.result?.value || "{}");
      if (Object.keys(data).length > 0) {
        console.log("   Found localStorage data:");
        console.log(JSON.stringify(data, null, 2).split("\n").map(l => "   " + l).join("\n"));
      } else {
        console.log("   No AI-related localStorage data found");
      }
    } catch (e: any) {
      console.log("   Error checking localStorage:", e.message);
    }

    // 4. Check sessionStorage
    console.log("\n4. Checking sessionStorage for AI data...");
    try {
      const result = await send("Runtime.evaluate", {
        expression: `
          (function() {
            const found = {};
            const keys = Object.keys(sessionStorage);
            for (const key of keys) {
              if (key.toLowerCase().includes('ai') ||
                  key.toLowerCase().includes('session') ||
                  key.toLowerCase().includes('event') ||
                  key.toLowerCase().includes('question') ||
                  key.toLowerCase().includes('agent')) {
                try {
                  found[key] = JSON.parse(sessionStorage.getItem(key));
                } catch {
                  found[key] = sessionStorage.getItem(key);
                }
              }
            }
            return JSON.stringify(found, null, 2);
          })()
        `,
        returnByValue: true
      });

      const data = JSON.parse(result?.result?.value || "{}");
      if (Object.keys(data).length > 0) {
        console.log("   Found sessionStorage data:");
        console.log(JSON.stringify(data, null, 2).split("\n").map(l => "   " + l).join("\n"));
      } else {
        console.log("   No AI-related sessionStorage data found");
      }
    } catch (e: any) {
      console.log("   Error checking sessionStorage:", e.message);
    }

    // 5. Search the window object for anything AI-related
    console.log("\n5. Searching window object for AI-related properties...");
    try {
      const result = await send("Runtime.evaluate", {
        expression: `
          (function() {
            const found = [];
            const checked = new Set();

            function search(obj, path, depth) {
              if (depth > 3) return;
              if (!obj || checked.has(obj)) return;
              checked.add(obj);

              try {
                const keys = Object.keys(obj);
                for (const key of keys) {
                  const lowerKey = key.toLowerCase();
                  if (lowerKey.includes('askai') ||
                      lowerKey.includes('aiproxy') ||
                      lowerKey.includes('question_event') ||
                      lowerKey.includes('agentsession')) {
                    found.push({
                      path: path + '.' + key,
                      type: typeof obj[key],
                      preview: JSON.stringify(obj[key])?.slice(0, 200)
                    });
                  }
                }
              } catch {}
            }

            search(window, 'window', 0);

            return JSON.stringify(found, null, 2);
          })()
        `,
        returnByValue: true
      });

      const data = JSON.parse(result?.result?.value || "[]");
      if (data.length > 0) {
        console.log("   Found AI-related properties:");
        for (const item of data) {
          console.log(`   - ${item.path}: ${item.preview}`);
        }
      } else {
        console.log("   No AI-related window properties found");
      }
    } catch (e: any) {
      console.log("   Error searching window:", e.message);
    }

    // 6. Check IndexedDB databases
    console.log("\n6. Checking IndexedDB databases...");
    try {
      const result = await send("Runtime.evaluate", {
        expression: `
          (async function() {
            const dbs = await indexedDB.databases();
            return JSON.stringify(dbs.map(db => ({name: db.name, version: db.version})), null, 2);
          })()
        `,
        awaitPromise: true,
        returnByValue: true
      });

      const dbs = JSON.parse(result?.result?.value || "[]");
      console.log("   Found databases:", dbs);

      // Look for AI-related data in databases
      for (const db of dbs) {
        if (db.name) {
          try {
            const storesResult = await send("Runtime.evaluate", {
              expression: `
                (async function() {
                  return new Promise((resolve, reject) => {
                    const request = indexedDB.open("${db.name}");
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                      const db = request.result;
                      const stores = Array.from(db.objectStoreNames);
                      db.close();
                      resolve(JSON.stringify(stores));
                    };
                  });
                })()
              `,
              awaitPromise: true,
              returnByValue: true
            });

            const stores = JSON.parse(storesResult?.result?.value || "[]");
            const aiStores = stores.filter((s: string) =>
              s.toLowerCase().includes('ai') ||
              s.toLowerCase().includes('event') ||
              s.toLowerCase().includes('session')
            );

            if (aiStores.length > 0) {
              console.log(`   Database "${db.name}" has AI-related stores:`, aiStores);
            }
          } catch {}
        }
      }
    } catch (e: any) {
      console.log("   Error checking IndexedDB:", e.message);
    }

    // 7. Try to find the Redux/MobX store
    console.log("\n7. Looking for state management stores...");
    try {
      const result = await send("Runtime.evaluate", {
        expression: `
          (function() {
            // Try common state management patterns
            const stores = [];

            // Redux DevTools
            if (window.__REDUX_DEVTOOLS_EXTENSION__) {
              stores.push('Redux DevTools available');
            }

            // Check for store on common locations
            if (window.store) stores.push('window.store exists');
            if (window.__store__) stores.push('window.__store__ exists');
            if (window.reduxStore) stores.push('window.reduxStore exists');
            if (window.__STORE__) stores.push('window.__STORE__ exists');

            // MobX
            if (window.__mobx__) stores.push('MobX detected');

            // Superhuman specific
            if (window.superhuman) stores.push('window.superhuman exists');
            if (window.app) stores.push('window.app exists');

            return JSON.stringify(stores);
          })()
        `,
        returnByValue: true
      });

      const stores = JSON.parse(result?.result?.value || "[]");
      if (stores.length > 0) {
        console.log("   Found stores:", stores);
      } else {
        console.log("   No common state stores found");
      }
    } catch (e: any) {
      console.log("   Error:", e.message);
    }

    // 8. Listen for live network traffic
    console.log("\n8. Listening for live network traffic (30 seconds)...");
    console.log("   Create some Ask AI threads now to capture requests!\n");

    await new Promise(resolve => setTimeout(resolve, 30000));

    // Summary
    console.log("\n=== SUMMARY ===\n");
    if (capturedRequests.length > 0) {
      console.log(`Captured ${capturedRequests.length} AI requests:\n`);
      for (const req of capturedRequests) {
        console.log(`URL: ${req.url}`);
        console.log(`Body: ${JSON.stringify(req.body, null, 2)}`);
        console.log();
      }
    } else {
      console.log("No live AI requests captured.");
      console.log("The requests may have already been made before monitoring started.");
    }

    ws.close();
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
}

checkCachedRequests().catch(console.error);
