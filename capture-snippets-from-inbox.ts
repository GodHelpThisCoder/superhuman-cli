/**
 * Capture the actual snippet data from userdata.getThreads response
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

async function capture() {
  const target = await getSuperhuman();
  if (!target) { console.error("Superhuman not found"); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl!);
  let msgId = 0;
  const pendingRequests = new Map<string, any>();
  const pendingResponses = new Map<string, Function>();

  const send = (method: string, params: any = {}): Promise<any> => {
    const id = ++msgId;
    return new Promise(resolve => {
      pendingResponses.set(String(id), resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  ws.on("open", async () => {
    console.log("=== Capturing Snippet API Response ===\n");

    await send("Network.enable", {});

    console.log("Network enabled. Now press g ; from inbox.\n");
  });

  ws.on("message", async (data: Buffer) => {
    const msg = JSON.parse(data.toString());

    // Handle responses to our commands
    if (msg.id && pendingResponses.has(String(msg.id))) {
      const resolve = pendingResponses.get(String(msg.id))!;
      pendingResponses.delete(String(msg.id));
      resolve(msg.result);
      return;
    }

    // Track requests
    if (msg.method === "Network.requestWillBeSent") {
      const { requestId, request } = msg.params;
      if (request.url.includes("userdata.getThreads")) {
        console.log(`[REQ] ${request.method} ${request.url}`);
        if (request.postData) console.log(`  BODY: ${request.postData}`);
        pendingRequests.set(requestId, request);
      }
    }

    // Capture response body when loading finishes
    if (msg.method === "Network.loadingFinished") {
      const { requestId } = msg.params;
      if (pendingRequests.has(requestId)) {
        console.log(`\n[RESPONSE for ${requestId}]`);
        try {
          const body = await send("Network.getResponseBody", { requestId });
          if (body?.body) {
            try {
              const parsed = JSON.parse(body.body);
              console.log(JSON.stringify(parsed, null, 2));
            } catch {
              console.log(body.body.slice(0, 2000));
            }
          }
        } catch (e: any) {
          console.log("Error getting body:", e.message || e);
        }
        pendingRequests.delete(requestId);
        console.log("\n--- Got response. Press Ctrl+C to exit. ---");
      }
    }
  });

  process.on("SIGINT", () => {
    ws.close();
    process.exit(0);
  });
}

capture().catch(console.error);
