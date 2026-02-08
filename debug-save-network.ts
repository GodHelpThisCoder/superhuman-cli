
import { connectToSuperhuman, disconnect, openCompose, setSubject, addRecipient, setBody, saveDraft, textToHtml } from "./src/superhuman-api";

async function saveAndWatch() {
  console.log("=== Watching Network During Save ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Enable network monitoring
  await conn.Network.enable();

  const requests: any[] = [];
  const responses: any[] = [];

  // Capture network requests
  conn.Network.requestWillBeSent((params) => {
    if (params.request.url.includes('draft') || params.request.url.includes('gmail')) {
      requests.push({
        url: params.request.url,
        method: params.request.method,
        postData: params.request.postData?.substring(0, 500)
      });
    }
  });

  conn.Network.responseReceived((params) => {
    if (params.response.url.includes('draft') || params.response.url.includes('gmail')) {
      responses.push({
        url: params.response.url,
        status: params.response.status,
        statusText: params.response.statusText
      });
    }
  });

  // Open compose and set content
  console.log("1. Opening compose...");
  const draftKey = await openCompose(conn);
  console.log(`   draftKey: ${draftKey}`);

  console.log("2. Setting content...");
  await addRecipient(conn, "networktest@test.com", undefined, draftKey!);
  await setSubject(conn, "Network Test Subject", draftKey!);
  await setBody(conn, textToHtml("Network test body"), draftKey!);

  console.log("3. Saving draft...");
  const saved = await saveDraft(conn, draftKey!);
  console.log(`   saveDraft returned: ${saved}`);

  // Wait for network to complete
  await new Promise(r => setTimeout(r, 3000));

  console.log("\n4. Network requests related to drafts:");
  console.log(JSON.stringify(requests, null, 2));

  console.log("\n5. Network responses related to drafts:");
  console.log(JSON.stringify(responses, null, 2));

  await conn.Network.disable();
  await disconnect(conn);
}

saveAndWatch().catch(console.error);
