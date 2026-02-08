/**
 * Capture Ask AI network traffic via CDP.
 *
 * Monitors network requests for AI-related endpoints while the user
 * triggers Ask AI in the Superhuman UI.
 */

import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

const CDP_PORT = 9333;
const CAPTURE_DURATION_MS = 90_000; // 90 seconds

interface CapturedRequest {
  requestId: string;
  url: string;
  method: string;
  postData?: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  timestamp: number;
}

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(CDP_PORT);

  if (!conn) {
    console.error("Failed to connect. Make sure Superhuman is running with CDP.");
    process.exit(1);
  }

  const { Network, client } = conn;

  // Enable Network domain with request interception
  await Network.enable();

  const captured: CapturedRequest[] = [];
  const pendingRequests = new Map<string, CapturedRequest>();

  // URL patterns to match
  const patterns = [
    /ai/i,
    /ask/i,
    /chat/i,
    /compose/i,
    /agent/i,
    /semantic/i,
    /suggest/i,
    /smart/i,
    /stream/i,
    /userdata/i,
  ];

  const shouldCapture = (url: string): boolean => {
    // Must be superhuman.com or related
    if (!url.includes("superhuman.com") && !url.includes("firebaseio.com")) return false;
    // Match against patterns
    return patterns.some(p => p.test(url));
  };

  // Capture requests
  Network.requestWillBeSent((params: any) => {
    const { requestId, request } = params;
    const url = request.url;

    if (!shouldCapture(url)) return;

    const entry: CapturedRequest = {
      requestId,
      url,
      method: request.method,
      postData: request.postData,
      timestamp: Date.now(),
    };

    pendingRequests.set(requestId, entry);
    captured.push(entry);

    console.log(`\n[REQUEST] ${request.method} ${url}`);
    if (request.postData) {
      try {
        const body = JSON.parse(request.postData);
        console.log(`  Body: ${JSON.stringify(body, null, 2).substring(0, 2000)}`);
      } catch {
        console.log(`  Body (raw): ${request.postData.substring(0, 1000)}`);
      }
    }
  });

  // Capture responses
  Network.responseReceived((params: any) => {
    const { requestId, response } = params;
    const entry = pendingRequests.get(requestId);
    if (!entry) return;

    entry.responseStatus = response.status;
    entry.responseHeaders = response.headers;

    console.log(`[RESPONSE] ${response.status} ${entry.url}`);
  });

  // Try to capture response bodies
  Network.loadingFinished(async (params: any) => {
    const { requestId } = params;
    const entry = pendingRequests.get(requestId);
    if (!entry) return;

    try {
      const bodyResult = await Network.getResponseBody({ requestId });
      if (bodyResult.body) {
        entry.responseBody = bodyResult.body.substring(0, 5000);
        console.log(`[BODY] ${entry.url}`);
        console.log(`  ${entry.responseBody.substring(0, 2000)}`);
      }
    } catch (e) {
      // Response body may not be available for streaming responses
    }
  });

  console.log("\n" + "=".repeat(70));
  console.log("LISTENING FOR AI-RELATED NETWORK TRAFFIC");
  console.log("=".repeat(70));
  console.log(`\nPlease trigger "Ask AI" in Superhuman within the next ${CAPTURE_DURATION_MS / 1000} seconds.`);
  console.log("Try these actions:");
  console.log("  1. Open Ask AI sidebar (Cmd+J or click AI icon)");
  console.log("  2. Type a question WITHOUT a thread open");
  console.log("  3. Type a question WITH a thread open");
  console.log("  4. Try 'Write with AI' from compose");
  console.log("\nWaiting...\n");

  // Wait for the capture duration
  await new Promise(resolve => setTimeout(resolve, CAPTURE_DURATION_MS));

  // Print summary
  console.log("\n" + "=".repeat(70));
  console.log(`CAPTURE COMPLETE - ${captured.length} requests captured`);
  console.log("=".repeat(70));

  for (const req of captured) {
    console.log(`\n--- Request ${req.requestId} ---`);
    console.log(`URL: ${req.url}`);
    console.log(`Method: ${req.method}`);
    console.log(`Status: ${req.responseStatus || "pending"}`);

    if (req.postData) {
      console.log(`Request Body:`);
      try {
        const body = JSON.parse(req.postData);
        console.log(JSON.stringify(body, null, 2));
      } catch {
        console.log(req.postData.substring(0, 3000));
      }
    }

    if (req.responseBody) {
      console.log(`Response Body (first 2000 chars):`);
      console.log(req.responseBody.substring(0, 2000));
    }
  }

  await disconnect(conn);
  console.log("\nDone.");
}

main().catch(console.error);
