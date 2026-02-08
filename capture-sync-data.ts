import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // Enable network monitoring with response bodies
  await conn.Network.enable({});

  const syncResponses: any[] = [];

  // Capture response bodies for sync endpoints
  conn.Network.responseReceived(async (params) => {
    const url = params.response.url;
    if (url.includes("userdata") || url.includes("sync") || url.includes("snippet") || url.includes("settings")) {
      try {
        const body = await conn.Network.getResponseBody({ requestId: params.requestId });
        syncResponses.push({
          url,
          status: params.response.status,
          bodyPreview: body.body?.slice(0, 2000)
        });
      } catch (e) {
        syncResponses.push({ url, error: "Could not get body" });
      }
    }
  });

  console.log("Monitoring for sync/userdata responses...");
  console.log("Navigate to Settings > Snippets in Superhuman, or refresh the page.\n");

  // Wait for user to trigger something
  await new Promise(r => setTimeout(r, 10000));

  console.log("\n=== Captured Sync Responses ===");
  for (const resp of syncResponses) {
    console.log("\nURL:", resp.url);
    console.log("Status:", resp.status);
    if (resp.bodyPreview) {
      // Check if body contains snippet-related data
      if (resp.bodyPreview.toLowerCase().includes("snippet")) {
        console.log("*** CONTAINS SNIPPET DATA ***");
      }
      console.log("Body preview:", resp.bodyPreview.slice(0, 500));
    }
  }

  await disconnect(conn);
}

main().catch(console.error);
