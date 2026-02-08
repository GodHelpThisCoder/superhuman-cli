#!/usr/bin/env bun
/**
 * Capture Superhuman Send API
 *
 * Monitors background page network traffic to discover how Superhuman sends emails.
 *
 * Usage:
 * 1. Open Superhuman with CDP: /Applications/Superhuman.app/Contents/MacOS/Superhuman --remote-debugging-port=9333
 * 2. Run this script: bun run src/api-investigation/capture-send-api.ts
 * 3. In Superhuman: Compose a test email, then hit Cmd+Enter to send
 * 4. Watch for the send API endpoint
 */

import CDP from "chrome-remote-interface";

const CDP_PORT = 9333;

async function main() {
  console.log("Capture Superhuman Send API");
  console.log("=".repeat(60));
  console.log("");
  console.log("Instructions:");
  console.log("1. In Superhuman, compose a test email (to yourself)");
  console.log("2. Hit Cmd+Enter (or click Send) to send");
  console.log("3. Watch for send-related API calls below");
  console.log("");
  console.log("Listening for 60 seconds...");
  console.log("-".repeat(60));
  console.log("");

  // Get all CDP targets
  const targets = await CDP.List({ port: CDP_PORT });
  console.log("Available targets:");
  targets.forEach(t => console.log(`  - ${t.type}: ${t.url}`));
  console.log("");

  // Find both background page and main renderer page
  const bgPage = targets.find(t => t.url.includes("background_page"));
  const rendererPage = targets.find(t =>
    t.url.includes("mail.superhuman.com") &&
    !t.url.includes("background_page") &&
    t.type === "page"
  );

  if (!rendererPage) {
    console.error("Renderer page not found. Is Superhuman running?");
    process.exit(1);
  }

  console.log(`Monitoring renderer page: ${rendererPage.url}`);
  if (bgPage) {
    console.log(`Also monitoring background page: ${bgPage.url}`);
  }
  console.log("");

  // Monitor background page (where all network traffic goes)
  const client = await CDP({ target: bgPage!.id, port: CDP_PORT });
  const { Network } = client;

  await Network.enable();

  // Keywords that might indicate send-related endpoints
  const sendKeywords = [
    "send", "dispatch", "submit", "post", "deliver",
    "outgoing", "mail", "message", "draft"
  ];

  const capturedRequests = new Map<string, any>();

  Network.requestWillBeSent((params: any) => {
    const url = params.request.url;
    const method = params.request.method;

    // Check if this might be a send-related endpoint
    const urlLower = url.toLowerCase();
    const isSendRelated = sendKeywords.some(kw => urlLower.includes(kw));
    const isBackend = url.includes("mail.superhuman.com") || url.includes("~backend");
    const isGmail = url.includes("googleapis.com/gmail");
    const isGraph = url.includes("graph.microsoft.com");

    if (isBackend || (isSendRelated && (isGmail || isGraph))) {
      console.log(`[${method}] ${url}`);

      if (params.request.postData) {
        try {
          const body = JSON.parse(params.request.postData);
          console.log("Request body:", JSON.stringify(body, null, 2).substring(0, 2000));
        } catch {
          console.log("Request body (raw):", params.request.postData.substring(0, 500));
        }
      }
      console.log("");

      capturedRequests.set(params.requestId, {
        url,
        method,
        postData: params.request.postData,
      });
    }
  });

  Network.responseReceived(async (params: any) => {
    const request = capturedRequests.get(params.requestId);
    if (request) {
      console.log(`[RESPONSE] ${request.url}`);
      console.log(`Status: ${params.response.status}`);

      try {
        const body = await Network.getResponseBody({ requestId: params.requestId });
        if (body.body) {
          try {
            const json = JSON.parse(body.body);
            console.log("Response:", JSON.stringify(json, null, 2).substring(0, 2000));
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

  // Listen for 60 seconds
  await new Promise(resolve => setTimeout(resolve, 60000));

  console.log("\nCapture complete. Disconnecting...");
  await client.close();
}

main().catch(console.error);
