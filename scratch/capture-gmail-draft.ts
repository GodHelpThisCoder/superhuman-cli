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

  console.log("\n=== Monitoring Gmail/Outlook API calls ===\n");
  console.log("Create and save a draft NOW.\n");

  Network.requestWillBeSent((params) => {
    const url = params.request.url;

    // Look for Gmail or MS Graph API calls
    if (url.includes('googleapis.com') || url.includes('graph.microsoft.com') ||
        url.includes('outlook.office')) {

      console.log(`\n${"=".repeat(70)}`);
      console.log(`[${params.request.method}] ${url}`);
      console.log(`Time: ${new Date().toISOString()}`);

      // Show auth header
      const auth = params.request.headers['Authorization'] || params.request.headers['authorization'];
      if (auth) {
        console.log(`Auth: ${auth.substring(0, 60)}...`);
      }

      if (params.request.postData) {
        try {
          const parsed = JSON.parse(params.request.postData);
          console.log(`\nRequest Body:`);
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          // Might be base64 encoded email
          console.log(`\nRequest Body (raw, first 1000 chars):`);
          console.log(params.request.postData.substring(0, 1000));
        }
      }
    }
  });

  Network.responseReceived(async (params) => {
    const url = params.response.url;

    if (url.includes('googleapis.com') || url.includes('graph.microsoft.com') ||
        url.includes('outlook.office')) {

      try {
        const body = await Network.getResponseBody({ requestId: params.requestId });
        console.log(`\n[RESPONSE ${params.response.status}]`);

        try {
          const parsed = JSON.parse(body.body);
          const pretty = JSON.stringify(parsed, null, 2);
          console.log(pretty.substring(0, 2000));
        } catch {
          console.log(body.body.substring(0, 500));
        }
        console.log(`${"=".repeat(70)}`);
      } catch {}
    }
  });

  // Monitor for 60 seconds
  console.log("Monitoring for 60 seconds...\n");
  await new Promise(r => setTimeout(r, 60000));

  await client.close();
}

main().catch(console.error);
