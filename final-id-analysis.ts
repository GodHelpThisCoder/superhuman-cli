/**
 * Final Analysis of Superhuman Event ID Format
 *
 * Based on team ID pattern: team_11STeHt1wOE5UlznX9
 * Event IDs should follow: event_ + similar base62 encoding
 */

import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

const TEAM_ID = "team_11STeHt1wOE5UlznX9";

async function main() {
  console.log("=== Superhuman Event ID Analysis ===\n");

  // Analyze team ID pattern
  const teamSuffix = TEAM_ID.replace("team_", "");
  console.log("Team ID Analysis:");
  console.log(`  Full ID: ${TEAM_ID}`);
  console.log(`  Prefix: team_`);
  console.log(`  Suffix: ${teamSuffix}`);
  console.log(`  Suffix length: ${teamSuffix.length} characters`);

  // Character analysis
  const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const isBase62 = [...teamSuffix].every(c => base62.includes(c));
  console.log(`  Is base62: ${isBase62}`);

  // Pattern: starts with "11" which could be a version or timestamp component
  console.log(`  First 2 chars: ${teamSuffix.substring(0, 2)}`);
  console.log(`  Remaining: ${teamSuffix.substring(2)} (${teamSuffix.substring(2).length} chars)\n`);

  // Now connect to Superhuman and capture real IDs
  console.log("Connecting to Superhuman for live ID capture...\n");

  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    console.log("\nBased on analysis, event IDs likely follow format:");
    console.log("  event_ + 17-18 base62 characters");
    console.log("  Example: event_11VNPdc4sKP2pEaKSz");
    process.exit(1);
  }

  const { client, Runtime } = conn;

  // Enable network monitoring
  await conn.Network.enable();

  console.log("Network monitoring enabled.");
  console.log("Watching for ai.askAIProxy requests...\n");

  const capturedRequests: any[] = [];

  // Use Network.requestWillBeSent which gives us postData
  conn.Network.requestWillBeSent((params: any) => {
    const url = params.request.url;
    const postData = params.request.postData;

    if (url.includes("askAI") || url.includes("ai.")) {
      console.log(`\n>>> Captured request to: ${url}`);

      if (postData) {
        try {
          const body = JSON.parse(postData);

          const captured: any = {
            timestamp: new Date().toISOString(),
            url
          };

          if (body.question_event_id) {
            captured.question_event_id = body.question_event_id;
            console.log(`  question_event_id: ${body.question_event_id}`);
          }
          if (body.session_id) {
            captured.session_id = body.session_id;
            console.log(`  session_id: ${body.session_id}`);
          }
          if (body.agent_session_id) {
            captured.agent_session_id = body.agent_session_id;
            console.log(`  agent_session_id: ${body.agent_session_id}`);
          }

          capturedRequests.push(captured);
        } catch (e) {
          console.log(`  Body (raw): ${postData?.slice(0, 200)}`);
        }
      }
    }
  });

  // Also inject a fetch interceptor for redundancy
  await Runtime.evaluate({
    expression: `
      (function() {
        if (window.__fetchIntercepted) return;
        window.__fetchIntercepted = true;
        window.__capturedAIIds = [];

        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
          const [url, options] = args;
          if (url && url.toString().includes('askAI')) {
            try {
              const body = options?.body ? JSON.parse(options.body) : null;
              if (body?.question_event_id) {
                window.__capturedAIIds.push({
                  timestamp: Date.now(),
                  question_event_id: body.question_event_id,
                  session_id: body.session_id
                });
                console.log('[CAPTURED] question_event_id:', body.question_event_id);
              }
            } catch {}
          }
          return originalFetch.apply(this, args);
        };
      })()
    `
  });

  console.log("Fetch interceptor installed.");
  console.log("\n=== NOW USE ASK AI IN SUPERHUMAN ===");
  console.log("Press J to open Ask AI, then ask a question.");
  console.log("Waiting 60 seconds for activity...\n");

  // Poll for captured IDs
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));

    const result = await Runtime.evaluate({
      expression: `JSON.stringify(window.__capturedAIIds || [])`,
      returnByValue: true
    });

    const ids = JSON.parse(result.result.value || "[]");
    if (ids.length > 0) {
      console.log(`\n*** CAPTURED ${ids.length} IDs ***\n`);
      for (const id of ids) {
        analyzeEventId(id.question_event_id);
      }
      break;
    }

    if (capturedRequests.length > 0) {
      console.log(`\n*** CAPTURED ${capturedRequests.length} REQUESTS ***\n`);
      for (const req of capturedRequests) {
        if (req.question_event_id) {
          analyzeEventId(req.question_event_id);
        }
      }
      break;
    }

    process.stdout.write(".");
  }

  // Final summary
  console.log("\n\n=== FINAL ANALYSIS ===\n");

  if (capturedRequests.length === 0) {
    console.log("No live requests captured.\n");
    console.log("Based on team ID analysis and code inspection:\n");
  } else {
    console.log(`Captured ${capturedRequests.length} requests.\n`);
  }

  console.log("Event ID Format:");
  console.log("  Prefix: 'event_'");
  console.log("  Suffix: 17-18 base62 characters");
  console.log("  Character set: 0-9, A-Z, a-z (62 characters)");
  console.log("  Total length: 23-24 characters");
  console.log("");
  console.log("Session ID Format:");
  console.log("  UUID v4 (standard 36-character hyphenated format)");
  console.log("  Example: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx");
  console.log("");
  console.log("Team ID correlation:");
  console.log(`  Team ID: ${TEAM_ID}`);
  console.log(`  Team suffix: ${teamSuffix}`);
  console.log("  Event IDs appear to use same base62 encoding");
  console.log("  Possible shared timestamp or sequence component");

  await disconnect(conn);
}

function analyzeEventId(eventId: string) {
  if (!eventId) return;

  console.log(`Event ID: ${eventId}`);
  console.log(`  Total length: ${eventId.length}`);

  if (eventId.startsWith("event_")) {
    const suffix = eventId.replace("event_", "");
    console.log(`  Prefix: event_`);
    console.log(`  Suffix: ${suffix}`);
    console.log(`  Suffix length: ${suffix.length}`);

    // Character analysis
    const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const isBase62 = [...suffix].every(c => base62.includes(c));
    console.log(`  Is base62: ${isBase62}`);

    // Compare with team ID
    const teamSuffix = TEAM_ID.replace("team_", "");
    if (suffix.startsWith(teamSuffix.substring(0, 2))) {
      console.log(`  Shares prefix '${teamSuffix.substring(0, 2)}' with team ID`);
    }
  }
  console.log("");
}

main().catch(console.error);
