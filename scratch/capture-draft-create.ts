import CDP from "chrome-remote-interface";

async function main() {
  const targets = await CDP.List({ port: 9333 });
  const bgPage = targets.find(t => t.url.includes('background_page'));

  if (!bgPage) {
    console.error("Background page not found.");
    return;
  }

  const client = await CDP({ target: bgPage.id, port: 9333 });
  const { Network } = client;

  await Network.enable();

  console.log("\n=== READY TO CAPTURE ===\n");
  console.log("1. Create a NEW draft in Superhuman (Cmd+N)");
  console.log("2. Add a recipient, subject, and body");
  console.log("3. Press Cmd+S to SAVE the draft");
  console.log("4. Wait a few seconds for sync\n");
  console.log("Monitoring ALL POST/PUT/PATCH requests...\n");

  Network.requestWillBeSent((params) => {
    const method = params.request.method;
    const url = params.request.url;

    // Only care about write operations
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
      return;
    }

    // Skip noise
    if (url.includes('amplitude') || url.includes('metrics') ||
        url.includes('users.active') || url.includes('gcal')) {
      return;
    }

    console.log(`\n${"🔥".repeat(30)}`);
    console.log(`[${method}] ${url}`);
    console.log(`Time: ${new Date().toISOString()}`);

    // Show headers that matter
    const headers = params.request.headers;
    console.log(`\nHeaders:`);
    console.log(`  Content-Type: ${headers['Content-Type'] || headers['content-type']}`);
    if (headers['Authorization']) {
      console.log(`  Authorization: ${headers['Authorization'].substring(0, 50)}...`);
    }

    if (params.request.postData) {
      console.log(`\nRequest Body (${params.request.postData.length} bytes):`);
      try {
        const parsed = JSON.parse(params.request.postData);
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        // Check if it's base64 (Gmail raw message format)
        if (params.request.postData.match(/^[A-Za-z0-9+/=]+$/)) {
          console.log(`[Base64 encoded, first 200 chars]: ${params.request.postData.substring(0, 200)}`);
          try {
            const decoded = Buffer.from(params.request.postData, 'base64').toString('utf-8');
            console.log(`\nDecoded (first 500 chars):\n${decoded.substring(0, 500)}`);
          } catch {}
        } else {
          console.log(params.request.postData.substring(0, 1000));
        }
      }
    }
    console.log(`${"🔥".repeat(30)}\n`);
  });

  // 90 second timeout
  console.log("Monitoring for 90 seconds...\n");
  await new Promise(r => setTimeout(r, 90000));

  await client.close();
}

main().catch(console.error);
