/**
 * Deep check for AI requests - look at websockets, background pages, etc.
 */
import WebSocket from "ws";

const CDP_URL = "http://localhost:9333";

async function main() {
  const response = await fetch(CDP_URL + "/json");
  const targets = await response.json() as any[];

  console.log("=== All CDP Targets ===\n");
  for (const t of targets) {
    console.log(`- ${t.type}: ${t.title || t.url}`);
  }

  // Connect to main page
  const mainPage = targets.find(t =>
    t.url.includes("mail.superhuman.com") &&
    t.url.indexOf("background") === -1 &&
    t.url.indexOf("serviceworker") === -1 &&
    t.webSocketDebuggerUrl
  );

  // Also connect to background page for network traffic
  const bgPage = targets.find(t =>
    t.url.includes("background_page") &&
    t.webSocketDebuggerUrl
  );

  // And service worker
  const sw = targets.find(t =>
    t.type === "service_worker" &&
    t.webSocketDebuggerUrl
  );

  console.log("\n=== Checking Main Page ===");
  if (mainPage) {
    await checkTarget(mainPage, "main");
  }

  console.log("\n=== Checking Background Page ===");
  if (bgPage) {
    await checkTarget(bgPage, "background");
  }

  console.log("\n=== Checking Service Worker ===");
  if (sw) {
    await checkTarget(sw, "service_worker");
  }

  // Now enable Network monitoring on main page and listen for a bit
  console.log("\n=== Enabling Live Network Monitoring ===");
  if (mainPage) {
    await monitorNetwork(mainPage);
  }
}

async function checkTarget(target: any, name: string) {
  console.log(`Target: ${target.title || target.url}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0;

  const send = (method: string, params: any = {}): Promise<any> => {
    return new Promise((resolve) => {
      const id = ++msgId;
      const timeout = setTimeout(() => {
        ws.off("message", handler);
        resolve(null);
      }, 5000);

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

  return new Promise<void>((resolve) => {
    ws.on("open", async () => {
      // Check for AI-related globals
      const expr = `
        (function() {
          const found = {};

          // Check common patterns
          if (typeof window !== 'undefined') {
            // Look for AI-related window properties
            for (const key of Object.getOwnPropertyNames(window)) {
              if (key.toLowerCase().includes('ai') ||
                  key.toLowerCase().includes('ask') ||
                  key.toLowerCase().includes('agent')) {
                try {
                  const val = window[key];
                  if (val !== undefined && val !== null) {
                    found[key] = typeof val === 'function' ? 'function' : JSON.stringify(val).slice(0, 200);
                  }
                } catch {}
              }
            }
          }

          // Check global/self
          if (typeof self !== 'undefined') {
            for (const key of Object.getOwnPropertyNames(self)) {
              if (key.toLowerCase().includes('ai') ||
                  key.toLowerCase().includes('ask') ||
                  key.toLowerCase().includes('agent')) {
                try {
                  const val = self[key];
                  if (val !== undefined && val !== null) {
                    found['self.' + key] = typeof val === 'function' ? 'function' : JSON.stringify(val).slice(0, 200);
                  }
                } catch {}
              }
            }
          }

          return JSON.stringify(found, null, 2);
        })()
      `;

      const result = await send("Runtime.evaluate", {
        expression: expr,
        returnByValue: true
      });

      if (result?.result?.value) {
        const parsed = JSON.parse(result.result.value);
        if (Object.keys(parsed).length > 0) {
          console.log(`  AI-related globals:`, parsed);
        } else {
          console.log("  No AI-related globals found");
        }
      }

      // Check for fetch/XHR interception
      const fetchExpr = `
        (function() {
          const info = {
            fetchPatched: typeof window !== 'undefined' && window.fetch && window.fetch.toString().includes('native') === false,
            xhrPatched: typeof window !== 'undefined' && window.XMLHttpRequest && window.XMLHttpRequest.prototype.open.toString().includes('native') === false
          };
          return JSON.stringify(info);
        })()
      `;

      const fetchResult = await send("Runtime.evaluate", {
        expression: fetchExpr,
        returnByValue: true
      });

      if (fetchResult?.result?.value) {
        console.log(`  Fetch/XHR patched:`, fetchResult.result.value);
      }

      ws.close();
      resolve();
    });

    ws.on("error", () => {
      resolve();
    });
  });
}

async function monitorNetwork(target: any) {
  console.log(`Monitoring: ${target.title}`);
  console.log("Will listen for 15 seconds for any AI requests...\n");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0;
  const capturedRequests: any[] = [];

  const send = (method: string, params: any = {}): Promise<any> => {
    return new Promise((resolve) => {
      const id = ++msgId;
      const timeout = setTimeout(() => {
        ws.off("message", handler);
        resolve(null);
      }, 5000);

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

  return new Promise<void>((resolve) => {
    ws.on("open", async () => {
      await send("Network.enable");

      // Also enable Fetch interception
      try {
        await send("Fetch.enable", {
          patterns: [
            { urlPattern: "*" }
          ]
        });
        console.log("Fetch interception enabled");
      } catch (e) {
        console.log("Could not enable Fetch interception");
      }

      console.log("Network monitoring enabled. Listening...\n");
    });

    ws.on("message", (data: any) => {
      const msg = JSON.parse(data.toString());

      if (msg.method === "Network.requestWillBeSent") {
        const { request, requestId } = msg.params;
        const { url, method, postData } = request;

        // Look for AI-related requests
        if (url.includes("askAI") ||
            url.includes("/ai.") ||
            url.includes("agent") ||
            url.includes("question") ||
            (postData && (postData.includes("askAI") || postData.includes("question_event_id") || postData.includes("agent_session")))) {

          console.log(`[AI REQUEST] ${method} ${url}`);
          if (postData) {
            try {
              const body = JSON.parse(postData);
              console.log("Body:", JSON.stringify(body, null, 2));
              capturedRequests.push({ url, body, timestamp: new Date().toISOString() });
            } catch {
              console.log("Raw postData:", postData.slice(0, 500));
            }
          }
          console.log("---");
        }

        // Also check for websocket upgrade requests
        if (url.includes("websocket") || url.includes("wss://") || url.includes("socket")) {
          console.log(`[WEBSOCKET] ${method} ${url}`);
        }
      }

      // Handle Fetch.requestPaused
      if (msg.method === "Fetch.requestPaused") {
        const { requestId, request } = msg.params;
        const { url, method, postData } = request;

        if (url.includes("askAI") ||
            url.includes("/ai.") ||
            url.includes("agent") ||
            (postData && (postData.includes("question_event_id") || postData.includes("agent_session")))) {

          console.log(`[INTERCEPTED] ${method} ${url}`);
          if (postData) {
            try {
              const body = JSON.parse(postData);
              console.log("Body:", JSON.stringify(body, null, 2));

              // Extract key IDs
              if (body.question_event_id) {
                console.log(">>> question_event_id:", body.question_event_id);
              }
              if (body.session_id) {
                console.log(">>> session_id:", body.session_id);
              }
              if (body.agent_session_id) {
                console.log(">>> agent_session_id:", body.agent_session_id);
              }

              capturedRequests.push({ url, body, timestamp: new Date().toISOString() });
            } catch {
              console.log("Raw postData:", postData?.slice(0, 500));
            }
          }
          console.log("---");
        }

        // Continue the request
        send("Fetch.continueRequest", { requestId }).catch(() => {});
      }

      // Check for WebSocket frames
      if (msg.method === "Network.webSocketFrameSent" || msg.method === "Network.webSocketFrameReceived") {
        const { response } = msg.params;
        if (response && response.payloadData) {
          const payload = response.payloadData;
          if (payload.includes("askAI") || payload.includes("question_event") || payload.includes("agent_session")) {
            console.log(`[WEBSOCKET ${msg.method.includes("Sent") ? "SENT" : "RECV"}]`);
            console.log(payload.slice(0, 1000));
            console.log("---");
          }
        }
      }
    });

    // After 15 seconds, summarize
    setTimeout(() => {
      console.log("\n=== SUMMARY ===");
      if (capturedRequests.length === 0) {
        console.log("No AI requests captured during monitoring period.");
        console.log("The AI requests may have already been made before monitoring started.");
        console.log("\nTo capture live requests:");
        console.log("1. Keep this script running");
        console.log("2. Go to Superhuman and open Ask AI (press J)");
        console.log("3. Type a question and wait for response");
      } else {
        console.log(`Captured ${capturedRequests.length} AI requests:`);
        for (const req of capturedRequests) {
          console.log(`\nURL: ${req.url}`);
          console.log(`Timestamp: ${req.timestamp}`);
          if (req.body?.question_event_id) {
            console.log(`question_event_id: ${req.body.question_event_id}`);
          }
          if (req.body?.session_id) {
            console.log(`session_id: ${req.body.session_id}`);
          }
        }
      }

      ws.close();
      resolve();
    }, 15000);
  });
}

main().catch(console.error);
