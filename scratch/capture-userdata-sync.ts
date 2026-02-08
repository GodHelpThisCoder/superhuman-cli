import CDP from "chrome-remote-interface";

async function main() {
  // Find the background page
  const targets = await CDP.List({ port: 9333 });
  const bgPage = targets.find(t => t.url.includes('background_page'));

  if (!bgPage) {
    console.error("Background page not found");
    return;
  }

  console.log("Connecting to background page...");

  const client = await CDP({ target: bgPage.id, port: 9333 });
  const { Network } = client;

  await Network.enable();

  console.log("\nCapturing /v3/userdata.sync responses...\n");
  console.log("Please create/edit a draft now.\n");

  const syncRequests: any[] = [];

  Network.requestWillBeSent((params) => {
    if (params.request.url.includes('userdata.sync')) {
      syncRequests.push({
        requestId: params.requestId,
        time: new Date().toISOString(),
        body: params.request.postData
      });
      console.log(`[REQ] userdata.sync: ${params.request.postData}`);
    }
  });

  Network.responseReceived(async (params) => {
    if (params.response.url.includes('userdata.sync')) {
      try {
        const body = await Network.getResponseBody({ requestId: params.requestId });
        console.log(`[RES] userdata.sync response (${body.body.length} bytes)`);
        console.log(`  First 1000 chars: ${body.body.substring(0, 1000)}`);
      } catch (e) {
        console.log(`[RES] userdata.sync - couldn't get body: ${e}`);
      }
    }
  });

  // Wait and monitor
  await new Promise(r => setTimeout(r, 30000));

  console.log("\n=== Summary ===");
  console.log(`Total userdata.sync requests: ${syncRequests.length}`);

  await client.close();
}

main().catch(console.error);
