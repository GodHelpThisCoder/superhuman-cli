/**
 * Debug the AI payload to find what's causing the 400 error
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";
import { getToken, extractUserPrefix, getThreadMessagesForAI, getSuperhumanToken, gmailFetch } from "../token-api";
import { listAccounts } from "../accounts";

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
  const formatPrefix = "11V";
  const midSection = randomBase62(4);
  const randomSuffix = randomBase62(7);
  return `event_${formatPrefix}${midSection}${userPrefix}${randomSuffix}`;
}

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333);

  if (!conn) {
    console.error("Failed to connect");
    process.exit(1);
  }

  try {
    // Get account info
    const accounts = await listAccounts(conn);
    const currentAccount = accounts.find((a) => a.isCurrent);
    if (!currentAccount) {
      console.error("No current account");
      process.exit(1);
    }

    console.log(`Current account: ${currentAccount.email}`);

    // Extract user prefix
    const userPrefix = await extractUserPrefix(conn);
    console.log(`User prefix: ${userPrefix}`);

    // Get tokens
    const oauthToken = await getToken(conn, currentAccount.email);
    const superhumanTokenInfo = await getSuperhumanToken(conn, currentAccount.email);
    const superhumanToken = superhumanTokenInfo.token;

    // Get a recent thread
    const threadsResult = await gmailFetch(oauthToken.accessToken, "/threads?maxResults=1");
    const threadId = threadsResult.threads[0].id;
    console.log(`Thread: ${threadId}`);

    // Get thread messages using the token-api function
    const threadMessages = await getThreadMessagesForAI(oauthToken, threadId);
    console.log(`Thread messages: ${threadMessages.length}`);

    // Build payload similar to askAI
    const sessionId = crypto.randomUUID();
    const questionEventId = generateEventId(userPrefix!);

    const payload1 = {
      session_id: sessionId,
      question_event_id: questionEventId,
      query: "What is this email about?",
      chat_history: [],
      user: {
        email: currentAccount.email,
        name: "",
        company: "",
        position: "",
      },
      local_datetime: new Date().toISOString(),
      current_thread_id: threadId,
      current_thread_messages: threadMessages,
    };

    console.log("\n=== Payload from askAI ===");
    console.log(JSON.stringify(payload1, null, 2).substring(0, 2000));

    // Now build payload matching the working test
    const thread = await gmailFetch(oauthToken.accessToken, `/threads/${threadId}?format=full`);
    const threadMessages2 = thread.messages.map((msg: any) => {
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

      let body = msg.snippet || "";
      function extractBody(part: any): void {
        if (part.mimeType === "text/plain" && part.body?.data) {
          body = Buffer.from(part.body.data, "base64url").toString("utf-8");
        }
        if (part.parts) part.parts.forEach(extractBody);
      }
      extractBody(msg.payload);

      return {
        message_id: msg.id,
        subject: getHeader("Subject"),
        body: body.substring(0, 2000),
      };
    });

    const payload2 = {
      session_id: sessionId,
      question_event_id: questionEventId,
      query: "What is this email about?",
      chat_history: [],
      user: {
        email: currentAccount.email,
        name: "",
        company: "",
        position: "",
      },
      local_datetime: new Date().toISOString(),
      current_thread_id: threadId,
      current_thread_messages: threadMessages2,
    };

    console.log("\n=== Payload from working test ===");
    console.log(JSON.stringify(payload2, null, 2).substring(0, 2000));

    // Compare the thread messages
    console.log("\n=== Thread message comparison ===");
    console.log("Payload1 keys:", Object.keys(threadMessages[0] || {}));
    console.log("Payload2 keys:", Object.keys(threadMessages2[0] || {}));

    // Test with payload1 (from askAI)
    console.log("\n=== Testing with payload1 ===");
    const response1 = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.askAIProxy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${superhumanToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload1),
    });
    console.log(`Response status: ${response1.status}`);
    if (!response1.ok) {
      console.log("Error:", await response1.text());
    } else {
      const text = await response1.text();
      console.log("Success:", text.substring(0, 500));
    }

    // Test with payload2 (from working test)
    console.log("\n=== Testing with payload2 ===");
    const response2 = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.askAIProxy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${superhumanToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload2),
    });
    console.log(`Response status: ${response2.status}`);
    if (!response2.ok) {
      console.log("Error:", await response2.text());
    } else {
      const text = await response2.text();
      console.log("Success:", text.substring(0, 500));
    }

  } finally {
    await disconnect(conn);
  }
}

main().catch(console.error);
