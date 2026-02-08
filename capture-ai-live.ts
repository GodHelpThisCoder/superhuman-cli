/**
 * Live capture of Ask AI requests by injecting a fetch interceptor
 * and monitoring Network events simultaneously
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

  const superhuman = targets.find(t =>
    t.url.includes("mail.superhuman.com") &&
    !t.url.includes("background") &&
    t.webSocketDebuggerUrl
  );

  return superhuman || null;
}

async function captureAILive() {
  console.log("=== Live Ask AI Request Capture ===\n");

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
          resolve(msg);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const capturedRequests: any[] = [];

  // Listen for ALL network events
  ws.on("message", (data: Buffer) => {
    const msg = JSON.parse(data.toString());

    if (msg.method === "Network.requestWillBeSent") {
      const { requestId, request } = msg.params;
      const { url, method, postData } = request;

      // Check for AI/askAI endpoints
      if (url.includes("askAI") || url.includes("/ai.") ||
          url.includes("ai-") || url.includes("/v3/ai")) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`[REQUEST] ${method} ${url}`);
        console.log(`Request ID: ${requestId}`);

        if (postData) {
          try {
            const body = JSON.parse(postData);
            console.log("\n--- Request Body ---");
            console.log(JSON.stringify(body, null, 2));

            // Extract key IDs
            if (body.question_event_id) {
              console.log(`\n>>> question_event_id: ${body.question_event_id}`);
            }
            if (body.session_id) {
              console.log(`>>> session_id: ${body.session_id}`);
            }
            if (body.agent_session_id) {
              console.log(`>>> agent_session_id: ${body.agent_session_id}`);
            }

            capturedRequests.push({
              url,
              requestId,
              body,
              timestamp: new Date().toISOString()
            });
          } catch {
            console.log("Raw body (not JSON):", postData.slice(0, 500));
          }
        }
        console.log("=".repeat(60) + "\n");
      }
    }

    if (msg.method === "Network.responseReceived") {
      const { requestId, response } = msg.params;
      if (response.url.includes("askAI") || response.url.includes("/ai.")) {
        console.log(`[RESPONSE] ${response.status} ${response.url}`);
      }
    }
  });

  ws.on("open", async () => {
    console.log("CDP connection established\n");

    // Enable Network monitoring with request bodies
    console.log("Enabling Network monitoring...");
    await send("Network.enable", {
      maxPostDataSize: 65536  // Capture up to 64KB of POST data
    });
    console.log("Network monitoring enabled\n");

    // Also inject a fetch wrapper for redundancy
    console.log("Injecting fetch interceptor...");
    const injectResult = await send("Runtime.evaluate", {
      expression: `
        (function() {
          if (window.__aiCaptureInstalled) return 'Already installed';
          window.__aiCaptureInstalled = true;
          window.__capturedAIRequests = [];

          const originalFetch = window.fetch;
          window.fetch = async function(url, options) {
            const urlStr = typeof url === 'string' ? url : url.toString();

            if (urlStr.includes('askAI') || urlStr.includes('/ai.') || urlStr.includes('/v3/ai')) {
              console.log('[AI CAPTURE] Intercepted:', urlStr);

              if (options?.body) {
                try {
                  const body = typeof options.body === 'string'
                    ? JSON.parse(options.body)
                    : options.body;

                  console.log('[AI CAPTURE] Body:', JSON.stringify(body, null, 2));

                  window.__capturedAIRequests.push({
                    url: urlStr,
                    body: body,
                    timestamp: new Date().toISOString()
                  });
                } catch (e) {
                  console.log('[AI CAPTURE] Raw body:', options.body);
                }
              }
            }

            return originalFetch.apply(this, arguments);
          };

          return 'Fetch interceptor installed';
        })()
      `,
      returnByValue: true
    });
    console.log("Inject result:", injectResult?.result?.result?.value);

    console.log("\n" + "=".repeat(60));
    console.log("MONITORING FOR ASK AI REQUESTS");
    console.log("Press J in Superhuman to open Ask AI and ask a question");
    console.log("Press Ctrl+C to stop and see summary");
    console.log("=".repeat(60) + "\n");

    // Poll for captured requests from the injected interceptor
    setInterval(async () => {
      try {
        const result = await send("Runtime.evaluate", {
          expression: "JSON.stringify(window.__capturedAIRequests || [])",
          returnByValue: true
        });
        const requests = JSON.parse(result?.result?.result?.value || "[]");
        if (requests.length > capturedRequests.length) {
          console.log(`\n[INJECTED CAPTURE] ${requests.length} total requests captured`);
        }
      } catch {}
    }, 5000);
  });

  // Handle Ctrl+C
  process.on("SIGINT", async () => {
    console.log("\n\n" + "=".repeat(60));
    console.log("CAPTURE SUMMARY");
    console.log("=".repeat(60) + "\n");

    // Get final state from injected interceptor
    try {
      const result = await send("Runtime.evaluate", {
        expression: "JSON.stringify(window.__capturedAIRequests || [])",
        returnByValue: true
      });
      const injectedRequests = JSON.parse(result?.result?.result?.value || "[]");
      if (injectedRequests.length > 0) {
        console.log(`From injected interceptor: ${injectedRequests.length} requests\n`);
        for (const req of injectedRequests) {
          console.log(`URL: ${req.url}`);
          console.log(`Body: ${JSON.stringify(req.body, null, 2)}`);
          console.log();
        }
      }
    } catch {}

    if (capturedRequests.length > 0) {
      console.log(`From CDP Network: ${capturedRequests.length} requests\n`);
      for (const req of capturedRequests) {
        console.log(`URL: ${req.url}`);
        console.log(`Timestamp: ${req.timestamp}`);
        if (req.body) {
          console.log(`Body:`);
          console.log(JSON.stringify(req.body, null, 2));

          // Highlight important IDs
          if (req.body.question_event_id) {
            console.log(`\n*** question_event_id: ${req.body.question_event_id}`);
            console.log(`    Length: ${req.body.question_event_id.length}`);

            // Analyze format
            if (req.body.question_event_id.startsWith("event_")) {
              const suffix = req.body.question_event_id.replace("event_", "");
              console.log(`    Prefix: event_`);
              console.log(`    Suffix: ${suffix} (${suffix.length} chars)`);
            }
          }
        }
        console.log();
      }
    } else {
      console.log("No AI requests captured from CDP Network.");
    }

    ws.close();
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
}

captureAILive().catch(console.error);
