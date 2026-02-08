/**
 * Network monitor - capture all requests when triggering snippet picker
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

async function monitor() {
  console.log("=== Network Monitor for Snippet Loading ===\n");

  const target = await getSuperhuman();
  if (!target) {
    console.error("Superhuman not found");
    process.exit(1);
  }

  console.log(`Connected to: ${target.title}\n`);
  console.log("Now go trigger g ; from inbox. Press Ctrl+C to stop.\n");
  console.log("-".repeat(60) + "\n");

  const ws = new WebSocket(target.webSocketDebuggerUrl!);
  let msgId = 0;

  const send = (method: string, params: any = {}): number => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return id;
  };

  ws.on("open", () => {
    send("Network.enable", {
      maxTotalBufferSize: 10000000,
      maxResourceBufferSize: 5000000
    });
  });

  ws.on("message", (data: Buffer) => {
    const msg = JSON.parse(data.toString());

    if (msg.method === "Network.requestWillBeSent") {
      const { request } = msg.params;
      const { url, method, postData } = request;

      // Log ALL requests so we can see what fires when snippet picker opens
      const short = url.length > 120 ? url.slice(0, 120) + "..." : url;
      console.log(`[REQ] ${method} ${short}`);

      if (postData) {
        try {
          const body = JSON.parse(postData);
          console.log(`  BODY: ${JSON.stringify(body).slice(0, 500)}`);
        } catch {
          console.log(`  BODY (raw): ${postData.slice(0, 300)}`);
        }
      }
    }

    if (msg.method === "Network.responseReceived") {
      const { response } = msg.params;
      const { url, status } = response;
      if (url.includes("snippet") || url.includes("setting") || url.includes("firebase") ||
          url.includes("firestore") || url.includes("superhuman")) {
        console.log(`[RES] ${status} ${url.slice(0, 120)}`);
      }
    }
  });

  process.on("SIGINT", () => {
    console.log("\n\nDone.");
    ws.close();
    process.exit(0);
  });
}

monitor().catch(console.error);
