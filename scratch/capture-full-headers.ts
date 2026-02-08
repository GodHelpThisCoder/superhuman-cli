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

  console.log("\n=== Capture FULL headers for writeMessage ===\n");
  console.log("Create and save a draft NOW.\n");

  Network.requestWillBeSent((params) => {
    if (params.request.url.includes('userdata.writeMessage')) {
      console.log("\n" + "=".repeat(70));
      console.log("URL:", params.request.url);
      console.log("\nALL HEADERS:");
      for (const [key, value] of Object.entries(params.request.headers)) {
        console.log(`  ${key}: ${value}`);
      }
      console.log("\nBODY:");
      console.log(params.request.postData);
      console.log("=".repeat(70));
    }
  });

  console.log("Monitoring for 60 seconds...\n");
  await new Promise(r => setTimeout(r, 60000));

  await client.close();
}

main().catch(console.error);
