/**
 * Capture actual request bodies from Ask AI requests
 * This intercepts fetch to capture request bodies
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

async function captureRequestBodies() {
  console.log("=== Capturing Ask AI Request Bodies ===\n");

  const target = await getSuperhuman();
  if (!target) {
    console.error("Superhuman not found");
    process.exit(1);
  }

  console.log(`Connected to: ${target.title}\n`);

  const ws = new WebSocket(target.webSocketDebuggerUrl!);
  let msgId = 0;

  const send = (method: string, params: any = {}): Promise<any> => {
    return new Promise((resolve) => {
      const id = ++msgId;
      const handler = (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.off("message", handler);
          resolve(msg.result);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  ws.on("open", async () => {
    // Enable Fetch domain to intercept requests
    console.log("Enabling request interception...\n");

    // First, inject a fetch wrapper to capture request bodies
    await send("Runtime.evaluate", {
      expression: `
        (function() {
          // Store captured requests
          window.__capturedAIRequests = window.__capturedAIRequests || [];

          // Only wrap once
          if (window.__fetchWrapped) return 'Already wrapped';
          window.__fetchWrapped = true;

          const originalFetch = window.fetch;
          window.fetch = async function(url, options) {
            // Check if this is an AI request
            if (url && url.toString().includes('askAI')) {
              console.log('[CAPTURED] Ask AI request:', url);

              if (options && options.body) {
                try {
                  const body = typeof options.body === 'string'
                    ? JSON.parse(options.body)
                    : options.body;

                  console.log('[CAPTURED] Request body:', JSON.stringify(body, null, 2));

                  window.__capturedAIRequests.push({
                    timestamp: new Date().toISOString(),
                    url: url.toString(),
                    body: body
                  });

                  // Keep only last 20 requests
                  if (window.__capturedAIRequests.length > 20) {
                    window.__capturedAIRequests.shift();
                  }
                } catch (e) {
                  console.log('[CAPTURED] Raw body:', options.body);
                }
              }
            }

            return originalFetch.apply(this, arguments);
          };

          return 'Fetch wrapper installed';
        })()
      `,
      returnByValue: true
    });

    console.log("Fetch wrapper installed. Now create Ask AI threads in Superhuman.\n");
    console.log("Waiting 60 seconds for activity...\n");

    // Poll for captured requests every 5 seconds
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const result = await send("Runtime.evaluate", {
        expression: `JSON.stringify(window.__capturedAIRequests || [], null, 2)`,
        returnByValue: true
      });

      const requests = JSON.parse(result?.result?.value || "[]");

      if (requests.length > 0) {
        console.log(`\n=== ${requests.length} Captured Request(s) ===\n`);

        for (const req of requests) {
          console.log(`Timestamp: ${req.timestamp}`);
          console.log(`URL: ${req.url}`);
          console.log(`Body: ${JSON.stringify(req.body, null, 2)}`);
          console.log("-".repeat(60) + "\n");
        }
      } else {
        console.log(`[${i * 5}s] No requests captured yet...`);
      }
    }

    ws.close();
  });
}

captureRequestBodies().catch(console.error);
