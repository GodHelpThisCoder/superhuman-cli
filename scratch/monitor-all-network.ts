import { connectToSuperhuman, disconnect, openCompose, setSubject, setBody, addRecipient, saveDraft, closeCompose } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const { Runtime, Network } = conn;

  // Enable network monitoring
  await Network.enable();

  console.log("Monitoring ALL network requests for 30 seconds...\n");
  console.log("I will create a draft, save it, and watch for any sync requests.\n");

  const allRequests: any[] = [];

  Network.requestWillBeSent((params) => {
    const url = params.request.url;
    // Skip common noise
    if (url.includes('amplitude') || url.includes('analytics') ||
        url.includes('fonts.') || url.includes('.png') || url.includes('.jpg')) {
      return;
    }
    allRequests.push({
      time: new Date().toISOString(),
      url: url.substring(0, 150),
      method: params.request.method,
      postData: params.request.postData?.substring(0, 300)
    });
    console.log(`[${params.request.method}] ${url.substring(0, 100)}`);
  });

  // Wait a moment for initial requests to settle
  await new Promise(r => setTimeout(r, 2000));
  console.log("\n--- Creating draft ---\n");

  // Create a draft
  const draftKey = await openCompose(conn);
  await addRecipient(conn, "test-sync@example.com", undefined, draftKey);
  await setSubject(conn, "Sync test " + Date.now(), draftKey);
  await setBody(conn, "<p>Testing if this syncs to backend</p>", draftKey);

  console.log("\n--- Saving draft ---\n");
  await saveDraft(conn, draftKey);

  console.log("\n--- Waiting 15 seconds for background sync ---\n");
  await new Promise(r => setTimeout(r, 15000));

  console.log("\n--- Closing compose ---\n");
  await closeCompose(conn);

  console.log("\n--- Waiting 5 more seconds ---\n");
  await new Promise(r => setTimeout(r, 5000));

  console.log("\n\n=== SUMMARY ===\n");
  console.log("Total requests captured:", allRequests.length);

  // Filter for interesting requests
  const interestingRequests = allRequests.filter(r =>
    r.url.includes('draft') ||
    r.url.includes('message') ||
    r.url.includes('thread') ||
    r.url.includes('sync') ||
    r.url.includes('~backend') ||
    r.url.includes('gmail.googleapis') ||
    r.url.includes('graph.microsoft')
  );

  console.log("\nInteresting requests:");
  console.log(JSON.stringify(interestingRequests, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
