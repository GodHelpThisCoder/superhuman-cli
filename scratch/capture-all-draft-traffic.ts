import CDP from "chrome-remote-interface";

async function main() {
  // Find the background page
  const targets = await CDP.List({ port: 9333 });
  const bgPage = targets.find(t => t.url.includes('background_page'));

  if (!bgPage) {
    console.error("Background page not found.");
    return;
  }

  console.log("Connecting to background page...");

  const client = await CDP({ target: bgPage.id, port: 9333 });
  const { Network } = client;

  await Network.enable();

  console.log("\n=== Monitoring ALL superhuman.com network traffic ===\n");
  console.log("Create and save a draft NOW. I'll capture everything.\n");

  const requests: Map<string, any> = new Map();

  Network.requestWillBeSent((params) => {
    const url = params.request.url;

    // Only log Superhuman backend traffic
    if (!url.includes('superhuman.com') && !url.includes('mail.superhuman')) {
      return;
    }

    // Skip noise
    if (url.includes('amplitude') || url.includes('metrics.write') ||
        url.includes('users.active') || url.includes('/contact/') ||
        url.includes('/photo')) {
      return;
    }

    requests.set(params.requestId, {
      time: new Date().toISOString(),
      url: url,
      method: params.request.method,
      body: params.request.postData,
    });

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[${params.request.method}] ${url}`);
    console.log(`Time: ${new Date().toISOString()}`);

    if (params.request.postData) {
      try {
        const parsed = JSON.parse(params.request.postData);
        console.log(`\nRequest Body:`);
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(`\nRequest Body (raw): ${params.request.postData.substring(0, 500)}`);
      }
    }
  });

  Network.responseReceived(async (params) => {
    const url = params.response.url;

    if (!url.includes('superhuman.com') && !url.includes('mail.superhuman')) {
      return;
    }

    if (url.includes('amplitude') || url.includes('metrics.write') ||
        url.includes('users.active') || url.includes('/contact/') ||
        url.includes('/photo')) {
      return;
    }

    try {
      const body = await Network.getResponseBody({ requestId: params.requestId });
      console.log(`\n[RESPONSE ${params.response.status}]`);

      try {
        const parsed = JSON.parse(body.body);
        const pretty = JSON.stringify(parsed, null, 2);
        if (pretty.length > 1500) {
          console.log(pretty.substring(0, 1500) + "\n... (truncated)");
        } else {
          console.log(pretty);
        }
      } catch {
        console.log(`Response (raw): ${body.body.substring(0, 500)}`);
      }
      console.log(`${"=".repeat(70)}`);
    } catch (e) {
      // Response body not available
    }
  });

  // Monitor for 60 seconds
  console.log("Monitoring for 60 seconds...\n");
  await new Promise(r => setTimeout(r, 60000));

  await client.close();
}

main().catch(console.error);
