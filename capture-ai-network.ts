/**
 * Capture network traffic from Superhuman to analyze Ask AI event IDs
 *
 * Run with: bun capture-ai-network.ts
 */

import WebSocket from "ws";

const CDP_URL = "http://localhost:9333";

interface CDPTarget {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  postData?: string;
  timestamp: number;
}

async function getSuperhuman(): Promise<CDPTarget | null> {
  const response = await fetch(`${CDP_URL}/json`);
  const targets: CDPTarget[] = await response.json();

  // Find Superhuman main window
  const superhuman = targets.find(t =>
    t.url.includes("mail.superhuman.com") &&
    !t.url.includes("background") &&
    t.webSocketDebuggerUrl
  );

  return superhuman || null;
}

async function captureNetworkTraffic() {
  console.log("=== Superhuman AI Network Traffic Capture ===\n");

  const target = await getSuperhuman();
  if (!target) {
    console.error("Superhuman not found. Make sure it's running with --remote-debugging-port=9333");
    process.exit(1);
  }

  console.log(`Connected to: ${target.title}`);
  console.log(`URL: ${target.url}\n`);

  const ws = new WebSocket(target.webSocketDebuggerUrl!);

  let msgId = 1;
  const send = (method: string, params: any = {}) => {
    const id = msgId++;
    ws.send(JSON.stringify({ id, method, params }));
    return id;
  };

  const aiRequests: any[] = [];
  const pendingBodies: Map<string, any> = new Map();

  ws.on("open", () => {
    console.log("CDP connection established\n");

    // Enable network monitoring
    send("Network.enable");

    console.log("Listening for AI-related network requests...");
    console.log("Create some Ask AI threads in Superhuman to capture traffic.\n");
    console.log("Press Ctrl+C to stop and see results.\n");
    console.log("-".repeat(60) + "\n");
  });

  ws.on("message", (data: Buffer) => {
    const msg = JSON.parse(data.toString());

    // Handle Network events
    if (msg.method === "Network.requestWillBeSent") {
      const { requestId, request, timestamp } = msg.params;
      const { url, method, postData } = request;

      // Look for AI-related requests
      if (url.includes("ai.") ||
          url.includes("askAI") ||
          url.includes("agent") ||
          url.includes("question") ||
          (postData && (postData.includes("askAI") || postData.includes("question_event_id")))) {

        console.log(`[${new Date().toISOString()}] REQUEST: ${method} ${url}`);

        if (postData) {
          try {
            const parsed = JSON.parse(postData);
            console.log("Request body:", JSON.stringify(parsed, null, 2));

            // Extract relevant IDs
            const ids: any = {};

            if (parsed.question_event_id) ids.question_event_id = parsed.question_event_id;
            if (parsed.session_id) ids.session_id = parsed.session_id;
            if (parsed.agent_session_id) ids.agent_session_id = parsed.agent_session_id;
            if (parsed.thread_id) ids.thread_id = parsed.thread_id;
            if (parsed.event_id) ids.event_id = parsed.event_id;

            // Check nested structures
            if (parsed.params) {
              if (parsed.params.question_event_id) ids.question_event_id = parsed.params.question_event_id;
              if (parsed.params.session_id) ids.session_id = parsed.params.session_id;
              if (parsed.params.agent_session_id) ids.agent_session_id = parsed.params.agent_session_id;
            }

            if (Object.keys(ids).length > 0) {
              console.log("\n*** CAPTURED IDS ***");
              console.log(JSON.stringify(ids, null, 2));
              aiRequests.push({
                timestamp: new Date().toISOString(),
                url,
                ids,
                fullBody: parsed
              });
            }
          } catch (e) {
            console.log("Raw body:", postData);
          }
        }
        console.log("-".repeat(60) + "\n");
      }

      // Also check for graphql/grpc requests that might contain AI data
      if (url.includes("superhuman.com") && postData) {
        try {
          const parsed = JSON.parse(postData);
          const bodyStr = JSON.stringify(parsed);

          if (bodyStr.includes("question_event_id") ||
              bodyStr.includes("askAI") ||
              bodyStr.includes("agent_session")) {
            console.log(`[${new Date().toISOString()}] FOUND AI DATA IN: ${url}`);
            console.log("Body:", JSON.stringify(parsed, null, 2));
            console.log("-".repeat(60) + "\n");

            aiRequests.push({
              timestamp: new Date().toISOString(),
              url,
              fullBody: parsed
            });
          }
        } catch (e) {
          // Not JSON, ignore
        }
      }
    }

    // Also capture response bodies for AI endpoints
    if (msg.method === "Network.responseReceived") {
      const { requestId, response } = msg.params;
      if (response.url.includes("ai.") || response.url.includes("askAI")) {
        send("Network.getResponseBody", { requestId });
        pendingBodies.set(requestId, response.url);
      }
    }
  });

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    console.log("\n\n=== CAPTURE SUMMARY ===\n");

    if (aiRequests.length === 0) {
      console.log("No AI requests captured.");
      console.log("Try creating Ask AI threads in Superhuman while this script is running.");
    } else {
      console.log(`Captured ${aiRequests.length} AI-related requests:\n`);

      for (const req of aiRequests) {
        console.log(`Timestamp: ${req.timestamp}`);
        console.log(`URL: ${req.url}`);
        if (req.ids) {
          console.log("IDs:");
          for (const [key, value] of Object.entries(req.ids)) {
            console.log(`  ${key}: ${value}`);

            // Analyze ID format
            if (typeof value === "string") {
              console.log(`    Length: ${value.length}`);
              console.log(`    Pattern: ${analyzeIdFormat(value as string)}`);
            }
          }
        }
        console.log();
      }

      // Try to find patterns
      console.log("\n=== ID PATTERN ANALYSIS ===\n");
      analyzePatterns(aiRequests);
    }

    ws.close();
    process.exit(0);
  });
}

function analyzeIdFormat(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return "UUID v4";
  }
  if (/^[0-9a-f]{24}$/i.test(id)) {
    return "MongoDB ObjectId";
  }
  if (/^[A-Za-z0-9_-]{22}$/i.test(id)) {
    return "Base64 UUID (22 chars)";
  }
  if (/^[A-Za-z0-9_-]{27}$/i.test(id)) {
    return "Firebase-style ID (27 chars)";
  }
  if (/^[A-Za-z0-9]{20,30}$/i.test(id)) {
    return `Alphanumeric (${id.length} chars)`;
  }
  if (id.includes("_")) {
    const parts = id.split("_");
    return `Prefixed ID: prefix="${parts[0]}", rest="${parts.slice(1).join("_")}"`;
  }
  return `Unknown format (${id.length} chars)`;
}

function analyzePatterns(requests: any[]) {
  const questionEventIds = requests
    .filter(r => r.ids?.question_event_id)
    .map(r => r.ids.question_event_id);

  const sessionIds = requests
    .filter(r => r.ids?.session_id)
    .map(r => r.ids.session_id);

  const agentSessionIds = requests
    .filter(r => r.ids?.agent_session_id)
    .map(r => r.ids.agent_session_id);

  if (questionEventIds.length > 0) {
    console.log("question_event_id values:");
    for (const id of [...new Set(questionEventIds)]) {
      console.log(`  ${id}`);
    }
    console.log();
  }

  if (sessionIds.length > 0) {
    console.log("session_id values:");
    for (const id of [...new Set(sessionIds)]) {
      console.log(`  ${id}`);
    }
    console.log();
  }

  if (agentSessionIds.length > 0) {
    console.log("agent_session_id values:");
    for (const id of [...new Set(agentSessionIds)]) {
      console.log(`  ${id}`);
    }
    console.log();
  }

  // Check for team ID correlation
  const teamId = "team_11STeHt1wOE5UlznX9";
  console.log(`\nChecking for correlation with team ID: ${teamId}`);

  for (const req of requests) {
    const bodyStr = JSON.stringify(req.fullBody || {});
    if (bodyStr.includes(teamId)) {
      console.log("  Found team ID in request body!");
    }
  }
}

// Also try to get cached network data
async function getCachedNetworkData() {
  console.log("\n=== Checking for cached network data ===\n");

  const target = await getSuperhuman();
  if (!target) return;

  const ws = new WebSocket(target.webSocketDebuggerUrl!);

  let msgId = 1;
  const responses: Map<number, any> = new Map();

  ws.on("open", () => {
    // Try to get cached resources
    const id = msgId++;
    ws.send(JSON.stringify({
      id,
      method: "Network.getCookies",
      params: {}
    }));

    // Also try to search in storage
    const id2 = msgId++;
    ws.send(JSON.stringify({
      id: id2,
      method: "Runtime.evaluate",
      params: {
        expression: `
          (function() {
            // Check localStorage for AI-related data
            const aiData = {};
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && (key.includes('ai') || key.includes('session') || key.includes('event'))) {
                try {
                  aiData[key] = JSON.parse(localStorage.getItem(key));
                } catch {
                  aiData[key] = localStorage.getItem(key);
                }
              }
            }
            return JSON.stringify(aiData, null, 2);
          })()
        `,
        returnByValue: true
      }
    }));

    // Check IndexedDB for cached requests
    const id3 = msgId++;
    ws.send(JSON.stringify({
      id: id3,
      method: "Runtime.evaluate",
      params: {
        expression: `
          (async function() {
            // List all IndexedDB databases
            const dbs = await indexedDB.databases();
            return JSON.stringify(dbs.map(db => ({name: db.name, version: db.version})), null, 2);
          })()
        `,
        awaitPromise: true,
        returnByValue: true
      }
    }));
  });

  ws.on("message", (data: Buffer) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && msg.result) {
      console.log(`Response ${msg.id}:`, JSON.stringify(msg.result, null, 2).slice(0, 500));
    }
  });

  // Give it a moment then close
  setTimeout(() => ws.close(), 2000);
}

// Main
captureNetworkTraffic();
