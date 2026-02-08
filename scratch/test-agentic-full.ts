/**
 * Full test of ai.composeAgentic with correct event ID format.
 *
 * Now that we know the event ID format works, let's capture the full
 * agentic response to understand the complete stream protocol.
 */

import { connectToSuperhuman, disconnect } from "../src/superhuman-api";
import { getCurrentAccount } from "../src/accounts";
import { extractSuperhumanToken, extractUserPrefix } from "../src/token-api";

const CDP_PORT = 9333;
const SUPERHUMAN_BACKEND_BASE = "https://mail.superhuman.com/~backend";

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomBase62(length: number): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += BASE62.charAt(Math.floor(Math.random() * BASE62.length));
  }
  return result;
}

function generateEventId(userPrefix: string): string {
  return `event_11V${randomBase62(4)}${userPrefix}${randomBase62(7)}`;
}

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(CDP_PORT);
  if (!conn) { console.error("Failed to connect."); process.exit(1); }

  const email = await getCurrentAccount(conn);
  if (!email) { console.error("No account."); process.exit(1); }
  console.log(`Account: ${email}`);

  const tokenInfo = await extractSuperhumanToken(conn, email);
  const userPrefix = await extractUserPrefix(conn);
  console.log(`User prefix: ${userPrefix}`);

  if (!userPrefix) {
    console.error("Could not extract user prefix.");
    process.exit(1);
  }

  // Test 1: Compose a new email (no thread context)
  console.log("\n" + "=".repeat(70));
  console.log("TEST 1: Compose new email via ai.composeAgentic (no thread)");
  console.log("=".repeat(70) + "\n");

  const sessionId1 = crypto.randomUUID();
  const eventId1 = generateEventId(userPrefix);

  const payload1 = {
    instructions: "Write a short email to my professor asking about office hours next week",
    session_id: sessionId1,
    local_datetime: new Date().toISOString(),
    question_event_id: eventId1,
    user: { name: "Ethan", email },
    draft_action: "compose",
    content: "",
    content_type: "text/html",
    thread_id: "",
    last_message_id: "",
    thread_content: "",
    subject: "",
    to: [],
    cc: [],
    bcc: [],
    interactive: false,
    selected_text: "",
    retry_count: 0,
    draft_id: "",
  };

  await testAgentic(tokenInfo.token, payload1);

  // Test 2: Interactive mode compose
  console.log("\n" + "=".repeat(70));
  console.log("TEST 2: Interactive compose via ai.composeAgentic");
  console.log("=".repeat(70) + "\n");

  const sessionId2 = crypto.randomUUID();
  const eventId2 = generateEventId(userPrefix);

  const payload2 = {
    instructions: "Help me write an email declining a meeting invitation politely",
    session_id: sessionId2,
    local_datetime: new Date().toISOString(),
    question_event_id: eventId2,
    user: { name: "Ethan", email },
    draft_action: "compose",
    content: "",
    content_type: "text/html",
    thread_id: "",
    last_message_id: "",
    thread_content: "",
    subject: "",
    to: [],
    cc: [],
    bcc: [],
    interactive: true,
    selected_text: "",
    retry_count: 0,
    draft_id: "",
  };

  await testAgentic(tokenInfo.token, payload2);

  // Test 3: Ask a general question (not about composing)
  console.log("\n" + "=".repeat(70));
  console.log("TEST 3: General question via ai.composeAgentic");
  console.log("=".repeat(70) + "\n");

  const sessionId3 = crypto.randomUUID();
  const eventId3 = generateEventId(userPrefix);

  const payload3 = {
    instructions: "What are some best practices for writing professional emails?",
    session_id: sessionId3,
    local_datetime: new Date().toISOString(),
    question_event_id: eventId3,
    user: { name: "Ethan", email },
    draft_action: "compose",
    content: "",
    content_type: "text/html",
    thread_id: "",
    last_message_id: "",
    thread_content: "",
    subject: "",
    to: [],
    cc: [],
    bcc: [],
    interactive: true,
    selected_text: "",
    retry_count: 0,
    draft_id: "",
  };

  await testAgentic(tokenInfo.token, payload3);

  // Test 4: Edit existing content via agentic
  console.log("\n" + "=".repeat(70));
  console.log("TEST 4: Edit existing content via ai.composeAgentic");
  console.log("=".repeat(70) + "\n");

  const sessionId4 = crypto.randomUUID();
  const eventId4 = generateEventId(userPrefix);

  const payload4 = {
    instructions: "Make this more formal and professional",
    session_id: sessionId4,
    local_datetime: new Date().toISOString(),
    question_event_id: eventId4,
    user: { name: "Ethan", email },
    draft_action: "compose",
    content: "<p>hey can we meet up tomorrow to talk about the project? lmk</p>",
    content_type: "text/html",
    thread_id: "",
    last_message_id: "",
    thread_content: "",
    subject: "Project Discussion",
    to: [],
    cc: [],
    bcc: [],
    interactive: false,
    selected_text: "",
    retry_count: 0,
    draft_id: "",
  };

  await testAgentic(tokenInfo.token, payload4);

  await disconnect(conn);
  console.log("\nAll tests complete.");
}

async function testAgentic(token: string, payload: any) {
  try {
    const response = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.composeAgentic`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`Error: ${errorText}`);
      return;
    }

    const text = await response.text();
    const lines = text.split("\n");

    let draftContent = "";
    let messageContent = "";
    const events: any[] = [];

    for (const line of lines) {
      if (line === "data: END") {
        console.log("[STREAM END]");
        break;
      }

      if (!line.startsWith("data: ")) continue;

      const jsonStr = line.substring(6).trim();
      if (!jsonStr) continue;

      try {
        const data = JSON.parse(jsonStr);
        events.push(data);

        // Categorize event types
        if (data.tool) {
          console.log(`[TOOL] ${data.tool.name} | process=${data.process} | agent=${data.active_agent}`);
          if (data.tool.input) {
            console.log(`  Input: ${JSON.stringify(data.tool.input).substring(0, 300)}`);
          }
          if (data.tool.output) {
            console.log(`  Output: ${JSON.stringify(data.tool.output).substring(0, 300)}`);
          }
        } else if (data.choices) {
          // OpenAI-style streaming
          const delta = data.choices?.[0]?.delta?.content;
          if (typeof delta === "string") {
            draftContent += delta;
            process.stdout.write(delta);
          }
        } else if (data.content) {
          messageContent += data.content;
        } else if (data.process || data.active_agent) {
          console.log(`[STATE] process=${data.process} | agent=${data.active_agent}`);
        }

        // Log any fields we haven't seen
        const knownFields = new Set(['event_id', 'in_reply_to_event_id', 'session_id', 'tool', 'process', 'active_agent', 'choices', 'content', 'object']);
        const unknownFields = Object.keys(data).filter(k => !knownFields.has(k));
        if (unknownFields.length > 0) {
          console.log(`[UNKNOWN FIELDS] ${unknownFields.join(', ')}: ${JSON.stringify(Object.fromEntries(unknownFields.map(k => [k, data[k]])), null, 0).substring(0, 300)}`);
        }
      } catch {
        // Ignore non-JSON lines
      }
    }

    if (draftContent) {
      console.log(`\n\n[DRAFT CONTENT]:\n${draftContent}\n`);
    }
    if (messageContent) {
      console.log(`\n[MESSAGE CONTENT]:\n${messageContent}\n`);
    }

    console.log(`\nTotal events: ${events.length}`);
    console.log(`Unique event types: ${[...new Set(events.map(e => e.tool?.name || (e.choices ? 'streaming_chunk' : 'other')))].join(', ')}`);

  } catch (e) {
    console.log(`Exception: ${(e as Error).message}`);
  }
}

main().catch(console.error);
