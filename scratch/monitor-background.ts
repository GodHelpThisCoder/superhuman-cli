import CDP from "chrome-remote-interface";

async function main() {
  // Find the background page
  const targets = await CDP.List({ port: 9333 });
  const bgPage = targets.find(t => t.url.includes('background_page'));

  if (!bgPage) {
    console.error("Background page not found");
    return;
  }

  console.log("Connecting to background page:", bgPage.url);

  const client = await CDP({ target: bgPage.id, port: 9333 });
  const { Network, Runtime } = client;

  await Network.enable();

  console.log("\nMonitoring background page network traffic...\n");
  console.log("Please create/save a draft in Superhuman now.\n");

  Network.requestWillBeSent((params) => {
    const url = params.request.url;
    // Skip noise
    if (url.includes('amplitude') || url.includes('fonts.') || url.includes('.png')) {
      return;
    }
    console.log(`[${params.request.method}] ${url}`);
    if (params.request.postData) {
      console.log(`  Body: ${params.request.postData.substring(0, 500)}`);
    }
  });

  // Also check what services are available in background
  const services = await Runtime.evaluate({
    expression: `
      (() => {
        const findings = {};

        // Check for any global services in background context
        if (typeof self !== 'undefined') {
          findings.selfKeys = Object.keys(self).filter(k =>
            k.includes('draft') || k.includes('Draft') ||
            k.includes('sync') || k.includes('Sync')
          ).slice(0, 20);
        }

        // Check for any message handlers
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          findings.hasChromeRuntime = true;
        }

        return findings;
      })()
    `,
    returnByValue: true,
  });

  console.log("Background services:", JSON.stringify(services.result.value, null, 2));

  // Monitor for 60 seconds
  console.log("\nMonitoring for 60 seconds... Press Ctrl+C to stop.\n");
  await new Promise(r => setTimeout(r, 60000));

  await client.close();
}

main().catch(console.error);
