import CDP from "chrome-remote-interface";

async function main() {
  // Find the background page
  const targets = await CDP.List({ port: 9333 });
  const bgPage = targets.find(t => t.url.includes('background_page'));

  if (!bgPage) {
    console.error("Background page not found. Is Superhuman running with --remote-debugging-port=9333?");
    return;
  }

  console.log("Connecting to background page...");

  const client = await CDP({ target: bgPage.id, port: 9333 });
  const { Network } = client;

  await Network.enable();

  console.log("\n=== Monitoring /v3/userdata.sync requests ===\n");
  console.log("Please CREATE and SAVE a draft in Superhuman now.\n");
  console.log("Looking for PUSH requests (not just polling)...\n");

  const requests: Map<string, any> = new Map();

  Network.requestWillBeSent((params) => {
    if (params.request.url.includes('userdata.sync')) {
      const body = params.request.postData;
      requests.set(params.requestId, {
        time: new Date().toISOString(),
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers,
        body: body,
      });

      // Check if this is more than just a poll (has more than startHistoryId)
      try {
        const parsed = JSON.parse(body || "{}");
        const keys = Object.keys(parsed);
        const isPushRequest = keys.length > 1 || !keys.includes('startHistoryId');

        console.log(`\n${"=".repeat(60)}`);
        console.log(`[${isPushRequest ? "PUSH" : "POLL"}] userdata.sync`);
        console.log(`Time: ${new Date().toISOString()}`);
        console.log(`Request ID: ${params.requestId}`);
        console.log(`\nHeaders:`);
        for (const [k, v] of Object.entries(params.request.headers)) {
          if (k.toLowerCase().includes('auth') || k.toLowerCase().includes('cookie') || k.toLowerCase() === 'x-sh-token') {
            console.log(`  ${k}: ${(v as string).substring(0, 50)}...`);
          }
        }
        console.log(`\nBody (${body?.length || 0} bytes):`);
        console.log(JSON.stringify(parsed, null, 2));

        if (isPushRequest) {
          console.log("\n🎯 THIS IS A PUSH REQUEST - CAPTURE THIS FORMAT!");
        }
      } catch {
        console.log(`[REQ] userdata.sync (non-JSON): ${body?.substring(0, 200)}`);
      }
    }
  });

  Network.responseReceived(async (params) => {
    if (params.response.url.includes('userdata.sync')) {
      const reqData = requests.get(params.requestId);
      try {
        const body = await Network.getResponseBody({ requestId: params.requestId });
        const parsed = JSON.parse(body.body);

        console.log(`\n[RESPONSE] Status: ${params.response.status}`);
        console.log(`Response (${body.body.length} bytes):`);

        // Pretty print but truncate large bodies
        const pretty = JSON.stringify(parsed, null, 2);
        if (pretty.length > 2000) {
          console.log(pretty.substring(0, 2000) + "\n... (truncated)");
        } else {
          console.log(pretty);
        }
        console.log(`${"=".repeat(60)}\n`);
      } catch (e) {
        console.log(`[RESPONSE] Couldn't get body: ${e}`);
      }
    }
  });

  // Monitor for 120 seconds
  console.log("Monitoring for 120 seconds... Press Ctrl+C to stop.\n");
  await new Promise(r => setTimeout(r, 120000));

  await client.close();
}

main().catch(console.error);
