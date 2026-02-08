/**
 * Capture network requests when using Superhuman's Ask AI search feature.
 * Monitors BOTH the main page AND the background page.
 *
 * Usage:
 *   1. Run: bun run scratch/capture-ai-search.ts
 *   2. In Superhuman, open Ask AI (Cmd+J) and do a search
 *   3. Press Ctrl+C when done
 */

const CDP_PORT = 9333;

async function connectCDP(targetId: string, label: string) {
  const ws = new WebSocket(`ws://localhost:${CDP_PORT}/devtools/page/${targetId}`);

  let msgId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  const listeners = new Map<string, ((params: any) => void)[]>();

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(e);
    setTimeout(() => reject(new Error("timeout")), 5000);
  });

  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
    if (msg.method) {
      const cbs = listeners.get(msg.method) || [];
      for (const cb of cbs) cb(msg.params);
    }
  };

  function send(method: string, params: any = {}): Promise<any> {
    const id = msgId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error("timeout"));
        }
      }, 10000);
    });
  }

  function on(event: string, cb: (params: any) => void) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event)!.push(cb);
  }

  return { send, on, ws, label };
}

function setupMonitoring(cdp: Awaited<ReturnType<typeof connectCDP>>) {
  const { on, send, label } = cdp;
  const requests = new Map<string, any>();

  on("Network.requestWillBeSent", (params: any) => {
    const { request, requestId } = params;
    const url = request.url;
    requests.set(requestId, { url, method: request.method, postData: request.postData });

    // Show ALL non-static requests to catch everything
    if (url.includes(".js") || url.includes(".css") || url.includes(".png") ||
        url.includes(".woff") || url.includes(".svg") || url.includes("favicon")) return;

    console.log(`\n${"=".repeat(80)}`);
    console.log(`[${label}] 🟢 ${request.method} ${url}`);

    if (request.postData) {
      console.log("📦 Request Body:");
      try {
        const parsed = JSON.parse(request.postData);
        console.log(JSON.stringify(parsed, null, 2).substring(0, 5000));
      } catch {
        console.log(request.postData.substring(0, 2000));
      }
    }

    const headers = request.headers || {};
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === "authorization") {
        console.log(`🔑 Auth: ${(v as string).substring(0, 60)}...`);
      }
    }
  });

  on("Network.loadingFinished", async (params: any) => {
    const { requestId } = params;
    const req = requests.get(requestId);
    if (!req) return;
    const url = req.url;
    if (url.includes(".js") || url.includes(".css") || url.includes(".png") ||
        url.includes(".woff") || url.includes(".svg")) return;

    try {
      const body = await send("Network.getResponseBody", { requestId });
      if (body.body) {
        const bodyStr = body.base64Encoded
          ? Buffer.from(body.body, "base64").toString("utf-8")
          : body.body;

        if (bodyStr.length > 10) {
          console.log(`\n[${label}] 🏁 RESPONSE for ${url}`);
          console.log(bodyStr.substring(0, 8000));
        }
      }
    } catch {}
  });
}

async function main() {
  const targetsRes = await fetch(`http://localhost:${CDP_PORT}/json`);
  const targets = await targetsRes.json() as any[];

  console.log("Available CDP targets:");
  for (const t of targets) {
    if (t.url) console.log(`  [${t.type}] ${t.title || "(no title)"} - ${t.url.substring(0, 80)}`);
  }

  // Find targets to monitor
  const mainPage = targets.find((t: any) =>
    t.url?.includes("mail.superhuman.com") && t.url?.includes("@") && t.type === "page"
  );
  const bgPage = targets.find((t: any) =>
    t.url?.includes("background_page") && t.type === "page"
  );
  const swPage = targets.find((t: any) =>
    t.url?.includes("serviceworker") && t.type === "other"
  );

  const connections: Awaited<ReturnType<typeof connectCDP>>[] = [];

  if (mainPage) {
    console.log(`\nConnecting to MAIN: ${mainPage.title}`);
    try {
      const cdp = await connectCDP(mainPage.id, "MAIN");
      await cdp.send("Network.enable", { maxPostDataSize: 65536 });
      setupMonitoring(cdp);
      connections.push(cdp);
      console.log("  ✅ Main page monitoring active");
    } catch (e: any) {
      console.log(`  ❌ Failed: ${e.message}`);
    }
  }

  if (bgPage) {
    console.log(`Connecting to BACKGROUND: ${bgPage.url}`);
    try {
      const cdp = await connectCDP(bgPage.id, "BG");
      await cdp.send("Network.enable", { maxPostDataSize: 65536 });
      setupMonitoring(cdp);
      connections.push(cdp);
      console.log("  ✅ Background page monitoring active");
    } catch (e: any) {
      console.log(`  ❌ Failed: ${e.message}`);
    }
  }

  if (swPage) {
    console.log(`Connecting to SERVICE WORKER: ${swPage.url}`);
    try {
      const cdp = await connectCDP(swPage.id, "SW");
      await cdp.send("Network.enable", { maxPostDataSize: 65536 });
      setupMonitoring(cdp);
      connections.push(cdp);
      console.log("  ✅ Service worker monitoring active");
    } catch (e: any) {
      console.log(`  ❌ Failed: ${e.message}`);
    }
  }

  if (connections.length === 0) {
    console.error("No connections established!");
    process.exit(1);
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("🎯 MONITORING ACTIVE on", connections.length, "targets");
  console.log("Now open Ask AI in Superhuman (Cmd+J) and search for something.");
  console.log("Press Ctrl+C when done.");
  console.log("=".repeat(80));

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.log("\nShutting down...");
      for (const c of connections) c.ws.close();
      resolve();
    });
  });
}

main().catch(console.error);
