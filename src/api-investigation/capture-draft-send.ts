#!/usr/bin/env bun
/**
 * Capture Superhuman Draft Send API
 *
 * Discovers how Superhuman sends native drafts (draft00xxx format).
 *
 * Instructions:
 * 1. Open Superhuman with CDP: --remote-debugging-port=9333
 * 2. Create a draft in Superhuman (or open an existing one)
 * 3. Run this script
 * 4. Send the draft (Cmd+Enter)
 * 5. Watch for the send API call
 */

import CDP from "chrome-remote-interface";

const CDP_PORT = 9333;

async function main() {
  console.log("Capture Superhuman Draft Send API");
  console.log("=".repeat(60));
  console.log("");
  console.log("Instructions:");
  console.log("1. Open/create a draft in Superhuman");
  console.log("2. Hit Cmd+Enter to SEND the draft");
  console.log("3. Watch for send-related API calls");
  console.log("");
  console.log("Listening for 120 seconds...");
  console.log("-".repeat(60));
  console.log("");

  const targets = await CDP.List({ port: CDP_PORT });
  const bgPage = targets.find(t => t.url.includes("background_page"));

  if (!bgPage) {
    console.error("Background page not found");
    process.exit(1);
  }

  console.log(`Monitoring: ${bgPage.url}\n`);

  const client = await CDP({ target: bgPage.id, port: CDP_PORT });
  const { Network } = client;

  await Network.enable();

  const requests = new Map<string, any>();

  Network.requestWillBeSent((params: any) => {
    const url = params.request.url;
    const method = params.request.method;

    // Capture all Superhuman backend calls and Gmail/Graph send calls
    const isInteresting =
      url.includes("mail.superhuman.com/~backend") ||
      url.includes("gmail") && url.includes("send") ||
      url.includes("graph.microsoft.com") && (url.includes("send") || url.includes("mail"));

    if (isInteresting) {
      console.log(`[${method}] ${url}`);

      if (params.request.postData) {
        try {
          const body = JSON.parse(params.request.postData);
          // Pretty print but limit size
          const pretty = JSON.stringify(body, null, 2);
          if (pretty.length > 3000) {
            console.log("Request body (truncated):", pretty.substring(0, 3000) + "...");
          } else {
            console.log("Request body:", pretty);
          }
        } catch {
          console.log("Request body (raw):", params.request.postData.substring(0, 1000));
        }
      }
      console.log("");

      requests.set(params.requestId, { url, method, postData: params.request.postData });
    }
  });

  Network.responseReceived(async (params: any) => {
    const req = requests.get(params.requestId);
    if (req) {
      console.log(`[RESPONSE] ${req.url}`);
      console.log(`Status: ${params.response.status}`);

      try {
        const body = await Network.getResponseBody({ requestId: params.requestId });
        if (body.body) {
          try {
            const json = JSON.parse(body.body);
            const pretty = JSON.stringify(json, null, 2);
            if (pretty.length > 2000) {
              console.log("Response (truncated):", pretty.substring(0, 2000) + "...");
            } else {
              console.log("Response:", pretty);
            }
          } catch {
            console.log("Response (raw):", body.body.substring(0, 500));
          }
        }
      } catch (e) {
        // Response body may not be available
      }
      console.log("-".repeat(40));
      console.log("");
    }
  });

  // Listen for 120 seconds
  await new Promise(resolve => setTimeout(resolve, 120000));

  console.log("\nCapture complete.");
  await client.close();
}

main().catch(console.error);
