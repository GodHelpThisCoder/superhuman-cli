/**
 * Test different event ID generation strategies
 */

import { connectToSuperhuman, disconnect } from "./src/superhuman-api";
import { getToken, gmailFetch } from "./src/token-api";
import { listAccounts } from "./src/accounts";

const CDP_PORT = 9333;
const SUPERHUMAN_BACKEND_BASE = "https://mail.superhuman.com/~backend";

// Current implementation (random mixed-case alphanumeric)
function generateEventIdV1(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "event_";
  for (let i = 0; i < 17; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// V2: Start with "11" like team ID prefix
function generateEventIdV2(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "event_11";
  for (let i = 0; i < 15; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// V3: Match the exact pattern - 18 chars like team suffix
function generateEventIdV3(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "event_";
  for (let i = 0; i < 18; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// V4: Use crypto for better randomness
function generateEventIdV4(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let id = "event_";
  for (const byte of bytes) {
    id += chars[byte % 62];
  }
  return id;
}

async function testEventId(eventIdGenerator: () => string, name: string) {
  console.log(`\n=== Testing ${name} ===`);

  const conn = await connectToSuperhuman(CDP_PORT);
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    return null;
  }

  const { Runtime } = conn;

  // Get account info
  const accounts = await listAccounts(conn);
  const currentAccount = accounts.find((a) => a.isCurrent);
  if (!currentAccount) {
    console.error("No current account");
    await disconnect(conn);
    return null;
  }

  // Get idToken and googleId
  const tokenResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const authData = ga?.credential?._authData;
        return {
          idToken: authData?.idToken,
          googleId: authData?.googleId,
        };
      })()
    `,
    returnByValue: true,
  });

  const { idToken, googleId } = tokenResult.result.value;

  // Get OAuth token for Gmail
  const oauthToken = await getToken(conn, currentAccount.email);

  // Get a thread for context
  const threadId = "19b4d2a9561472a1";
  const thread = await gmailFetch(oauthToken.accessToken, `/threads/${threadId}?format=full`);
  if (!thread || !thread.messages) {
    console.error("Failed to fetch thread");
    await disconnect(conn);
    return null;
  }

  // Build thread messages
  const threadMessages = thread.messages.slice(0, 2).map((msg: any) => {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
    return {
      message_id: msg.id,
      subject: getHeader("Subject"),
      body: msg.snippet?.substring(0, 500) || "",
    };
  });

  const eventId = eventIdGenerator();
  console.log(`Generated event ID: ${eventId}`);
  console.log(`  Length: ${eventId.length}`);
  console.log(`  Suffix: ${eventId.replace('event_', '')}`);
  console.log(`  Suffix length: ${eventId.replace('event_', '').length}`);

  const payload = {
    session_id: crypto.randomUUID(),
    question_event_id: eventId,
    query: "what is this about?",
    chat_history: [],
    user: {
      provider_id: googleId,
      email: currentAccount.email,
      name: "",
      company: "",
      position: "",
    },
    local_datetime: new Date().toISOString(),
    current_thread_id: threadId,
    current_thread_messages: threadMessages,
  };

  const response = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.askAIProxy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log(`Response status: ${response.status}`);
  const responseText = await response.text();

  let result = null;
  try {
    result = JSON.parse(responseText);
    if (result.error) {
      console.log(`Error: ${result.error}`);
    } else if (result.response) {
      console.log(`SUCCESS! Response: ${result.response.substring(0, 100)}...`);
    }
  } catch {
    console.log(`Response: ${responseText.substring(0, 200)}`);
  }

  await disconnect(conn);
  return { eventId, status: response.status, result };
}

async function main() {
  console.log("=== Event ID Format Testing ===\n");

  // Show reference formats
  console.log("Reference formats:");
  console.log(`  Team ID:   team_11STeHt1wOE5UlznX9`);
  console.log(`  Team suffix length: 18`);
  console.log(`  Expected event ID: event_11VNPdc4sKP2pEaKSz`);
  console.log(`  Expected suffix length: 17`);

  // Generate samples
  console.log("\nSample IDs from each generator:");
  console.log(`  V1 (17 chars): ${generateEventIdV1()}`);
  console.log(`  V2 (11+15=17): ${generateEventIdV2()}`);
  console.log(`  V3 (18 chars): ${generateEventIdV3()}`);
  console.log(`  V4 (crypto 18): ${generateEventIdV4()}`);

  // Test each generator
  const results: any[] = [];

  // Test V1
  const r1 = await testEventId(generateEventIdV1, "V1: 17 random chars");
  if (r1) results.push({ name: "V1", ...r1 });

  // Wait between tests
  await new Promise(r => setTimeout(r, 1000));

  // Test V2
  const r2 = await testEventId(generateEventIdV2, "V2: 11 + 15 chars");
  if (r2) results.push({ name: "V2", ...r2 });

  await new Promise(r => setTimeout(r, 1000));

  // Test V3
  const r3 = await testEventId(generateEventIdV3, "V3: 18 chars");
  if (r3) results.push({ name: "V3", ...r3 });

  await new Promise(r => setTimeout(r, 1000));

  // Test V4
  const r4 = await testEventId(generateEventIdV4, "V4: crypto 18 chars");
  if (r4) results.push({ name: "V4", ...r4 });

  // Summary
  console.log("\n\n=== SUMMARY ===\n");
  for (const r of results) {
    console.log(`${r.name}: status=${r.status}, eventId=${r.eventId}`);
    if (r.result?.error) {
      console.log(`  Error: ${r.result.error}`);
    } else if (r.status === 200) {
      console.log(`  SUCCESS`);
    }
  }
}

main().catch(console.error);
