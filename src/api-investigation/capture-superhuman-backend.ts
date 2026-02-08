/**
 * Capture Superhuman Backend API Endpoints
 *
 * This script monitors network traffic via CDP to discover the actual REST endpoints
 * used by Superhuman's backend for operations like snooze, send, draft, etc.
 *
 * Usage:
 *   1. Start Superhuman with --remote-debugging-port=9333
 *   2. Run: bun run src/api-investigation/capture-superhuman-backend.ts
 *   3. Perform operations in Superhuman (snooze, send, draft, etc.)
 *   4. Review the captured endpoints
 */

import { connectToSuperhuman, type SuperhumanConnection } from "../superhuman-api";

interface CapturedRequest {
  url: string;
  method: string;
  timestamp: number;
  postData?: string;
  requestHeaders?: Record<string, string>;
  responseStatus?: number;
  responseBody?: string;
}

async function main() {
  console.log("Connecting to Superhuman...");

  const conn = await connectToSuperhuman();
  const { Network, Runtime } = conn;

  // Enable network monitoring
  await Network.enable({
    maxTotalBufferSize: 100000000,
    maxResourceBufferSize: 10000000,
  });

  const capturedRequests = new Map<string, CapturedRequest>();

  // Filter for Superhuman backend requests AND Gmail/MS Graph APIs
  const isSuperhmanBackend = (url: string) => {
    return (
      url.includes("mail.superhuman.com") ||
      url.includes("superhuman.com/~backend") ||
      url.includes("superhuman.com/api") ||
      url.includes("googleapis.com/gmail") ||
      url.includes("graph.microsoft.com")
    );
  };

  // Capture request details
  Network.requestWillBeSent(({ requestId, request, timestamp }: any) => {
    if (isSuperhmanBackend(request.url)) {
      capturedRequests.set(requestId, {
        url: request.url,
        method: request.method,
        timestamp,
        postData: request.postData,
        requestHeaders: request.headers,
      });
      console.log(`\n📤 REQUEST: ${request.method} ${request.url}`);
      if (request.postData) {
        try {
          const parsed = JSON.parse(request.postData);
          console.log("   Body:", JSON.stringify(parsed, null, 2).slice(0, 500));
        } catch {
          console.log("   Body:", request.postData.slice(0, 500));
        }
      }
    }
  });

  // Capture response details
  Network.responseReceived(({ requestId, response }: any) => {
    const req = capturedRequests.get(requestId);
    if (req) {
      req.responseStatus = response.status;
      console.log(`📥 RESPONSE: ${response.status} for ${req.url}`);
    }
  });

  // Capture response body when loading finished
  Network.loadingFinished(async ({ requestId }: any) => {
    const req = capturedRequests.get(requestId);
    if (req) {
      try {
        const { body, base64Encoded } = await Network.getResponseBody({ requestId });
        if (base64Encoded) {
          req.responseBody = Buffer.from(body, "base64").toString("utf-8");
        } else {
          req.responseBody = body;
        }
        if (req.responseBody) {
          try {
            const parsed = JSON.parse(req.responseBody);
            console.log("   Response:", JSON.stringify(parsed, null, 2).slice(0, 500));
          } catch {
            console.log("   Response:", req.responseBody.slice(0, 500));
          }
        }
      } catch (e) {
        // Response body may not be available
      }
    }
  });

  console.log("\n✅ Network monitoring enabled");
  console.log("📍 Filtering for: mail.superhuman.com, superhuman.com/~backend, superhuman.com/api");
  console.log("\n🎯 Now perform operations in Superhuman to capture API endpoints:");
  console.log("   - Snooze a thread");
  console.log("   - Unsnooze a thread");
  console.log("   - Create a draft");
  console.log("   - Send an email");
  console.log("   - Star a thread");
  console.log("   - Archive a thread");
  console.log("\nPress Ctrl+C to stop and see summary...\n");

  // Handle Ctrl+C to print summary
  process.on("SIGINT", () => {
    console.log("\n\n" + "=".repeat(80));
    console.log("CAPTURED SUPERHUMAN BACKEND ENDPOINTS");
    console.log("=".repeat(80));

    // Group by endpoint
    const endpoints = new Map<string, CapturedRequest[]>();
    for (const req of capturedRequests.values()) {
      const key = `${req.method} ${new URL(req.url).pathname}`;
      const existing = endpoints.get(key) || [];
      existing.push(req);
      endpoints.set(key, existing);
    }

    // Print summary
    const sortedEndpoints = Array.from(endpoints.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    for (const [endpoint, requests] of sortedEndpoints) {
      console.log(`\n${endpoint} (${requests.length} calls)`);

      // Show sample request/response
      const sample = requests[0];
      if (sample.postData) {
        console.log("  Sample request body:");
        try {
          const parsed = JSON.parse(sample.postData);
          console.log("  " + JSON.stringify(parsed, null, 2).replace(/\n/g, "\n  ").slice(0, 1000));
        } catch {
          console.log("  " + sample.postData.slice(0, 500));
        }
      }
      if (sample.responseBody) {
        console.log("  Sample response body:");
        try {
          const parsed = JSON.parse(sample.responseBody);
          console.log("  " + JSON.stringify(parsed, null, 2).replace(/\n/g, "\n  ").slice(0, 1000));
        } catch {
          console.log("  " + sample.responseBody.slice(0, 500));
        }
      }
    }

    console.log("\n" + "=".repeat(80));
    console.log(`Total: ${capturedRequests.size} requests to ${endpoints.size} unique endpoints`);
    console.log("=".repeat(80));

    process.exit(0);
  });

  // Keep the script running
  await new Promise(() => {});
}

main().catch(console.error);
