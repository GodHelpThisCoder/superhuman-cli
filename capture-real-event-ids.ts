/**
 * Capture REAL event IDs from Superhuman by intercepting at the CDP level
 * using Fetch.requestPaused
 */

import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  console.log("=== Real Event ID Capture ===\n");

  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  const { client } = conn;
  const capturedIds: any[] = [];

  // Enable Network domain for basic monitoring
  await conn.Network.enable();

  // Enable Fetch domain for request interception
  const Fetch = client.Fetch;
  await Fetch.enable({
    patterns: [
      { urlPattern: "*askAI*" },
      { urlPattern: "*ai.*" },
      { urlPattern: "*agent*" }
    ]
  });

  // Listen for paused requests
  Fetch.requestPaused(async (params: any) => {
    const { requestId, request } = params;
    const { url, method, postData } = request;

    console.log(`\n[INTERCEPTED] ${method} ${url}`);

    if (postData) {
      try {
        const body = JSON.parse(postData);
        console.log("\nRequest body keys:", Object.keys(body));

        if (body.question_event_id) {
          console.log("\n*** FOUND question_event_id: " + body.question_event_id);
          capturedIds.push({
            type: "question_event_id",
            value: body.question_event_id,
            length: body.question_event_id.length,
            timestamp: new Date().toISOString()
          });
        }

        if (body.session_id) {
          console.log("*** FOUND session_id: " + body.session_id);
          capturedIds.push({
            type: "session_id",
            value: body.session_id,
            length: body.session_id.length,
            timestamp: new Date().toISOString()
          });
        }

        if (body.agent_session_id) {
          console.log("*** FOUND agent_session_id: " + body.agent_session_id);
          capturedIds.push({
            type: "agent_session_id",
            value: body.agent_session_id,
            length: body.agent_session_id.length,
            timestamp: new Date().toISOString()
          });
        }

        // Show full body for analysis
        console.log("\nFull body:", JSON.stringify(body, null, 2).slice(0, 2000));

      } catch (e) {
        console.log("Raw body:", postData?.slice(0, 500));
      }
    }

    // Continue the request
    try {
      await Fetch.continueRequest({ requestId });
    } catch (e) {
      // Ignore if already continued
    }
  });

  // Also listen for regular network requests as backup
  conn.Network.requestWillBeSent((params: any) => {
    const { request } = params;
    if (request.url.includes("askAI") && request.postData) {
      try {
        const body = JSON.parse(request.postData);
        if (body.question_event_id) {
          console.log("\n[Network.requestWillBeSent] question_event_id:", body.question_event_id);
          capturedIds.push({
            type: "question_event_id_network",
            value: body.question_event_id,
            length: body.question_event_id.length,
            timestamp: new Date().toISOString()
          });
        }
      } catch {}
    }
  });

  console.log("Interception enabled!");
  console.log("Now use 'Ask AI' in Superhuman (press J, then type a question)");
  console.log("Press Ctrl+C to stop and see summary\n");
  console.log("-".repeat(60));

  // Keep running
  process.on("SIGINT", async () => {
    console.log("\n\n=== CAPTURED IDS SUMMARY ===\n");

    if (capturedIds.length === 0) {
      console.log("No IDs captured. Make sure you used Ask AI while this was running.");
    } else {
      // Dedupe and analyze
      const uniqueIds = [...new Map(capturedIds.map(c => [c.value, c])).values()];

      console.log(`Captured ${uniqueIds.length} unique IDs:\n`);

      for (const id of uniqueIds) {
        console.log(`Type: ${id.type}`);
        console.log(`Value: ${id.value}`);
        console.log(`Length: ${id.length}`);

        // Analyze format
        if (id.value.startsWith("event_")) {
          const suffix = id.value.replace("event_", "");
          console.log(`Prefix: event_`);
          console.log(`Suffix: ${suffix} (${suffix.length} chars)`);

          // Check if it matches team ID pattern
          const teamSuffix = "11STeHt1wOE5UlznX9";
          if (suffix.startsWith(teamSuffix.substring(0, 2))) {
            console.log(`>>> Starts with '${teamSuffix.substring(0, 2)}' - same as team ID!`);
          }
        }

        if (id.type.includes("session")) {
          // Check UUID format
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (uuidPattern.test(id.value)) {
            console.log(`Format: UUID v4`);
          }
        }

        console.log();
      }

      // Pattern analysis
      console.log("=== PATTERN ANALYSIS ===\n");

      const eventIds = uniqueIds.filter(id => id.type === "question_event_id");
      if (eventIds.length > 0) {
        console.log("Event ID patterns:");
        for (const eid of eventIds) {
          const suffix = eid.value.replace("event_", "");
          console.log(`  ${eid.value}`);
          console.log(`    - Total length: ${eid.value.length}`);
          console.log(`    - Suffix length: ${suffix.length}`);
          console.log(`    - Charset: ${detectCharset(suffix)}`);
        }
      }

      const sessionIds = uniqueIds.filter(id => id.type.includes("session"));
      if (sessionIds.length > 0) {
        console.log("\nSession ID patterns:");
        for (const sid of sessionIds) {
          console.log(`  ${sid.value}`);
          console.log(`    - Length: ${sid.value.length}`);
          console.log(`    - Format: ${detectFormat(sid.value)}`);
        }
      }
    }

    await Fetch.disable().catch(() => {});
    await disconnect(conn);
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

function detectCharset(str: string): string {
  const hasLower = /[a-z]/.test(str);
  const hasUpper = /[A-Z]/.test(str);
  const hasDigit = /[0-9]/.test(str);
  const hasSpecial = /[^a-zA-Z0-9]/.test(str);

  const parts = [];
  if (hasLower) parts.push("lowercase");
  if (hasUpper) parts.push("uppercase");
  if (hasDigit) parts.push("digits");
  if (hasSpecial) parts.push("special");

  return parts.join(" + ");
}

function detectFormat(str: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return "UUID v4";
  }
  if (/^[0-9a-f]{24}$/i.test(str)) {
    return "MongoDB ObjectId";
  }
  if (/^[A-Za-z0-9_-]{22}$/.test(str)) {
    return "Base64 UUID (22 chars)";
  }
  if (/^[A-Za-z0-9]{20,30}$/.test(str)) {
    return `Alphanumeric (${str.length} chars)`;
  }
  return `Unknown (${str.length} chars)`;
}

main().catch(console.error);
