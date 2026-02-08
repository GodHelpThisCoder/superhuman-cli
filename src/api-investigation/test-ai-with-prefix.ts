/**
 * Test AI API with properly prefixed event ID
 *
 * Based on our analysis:
 * - Position 0-2: "11V" (format prefix)
 * - Position 3-6: varies (timestamp-like)
 * - Position 7-10: "4sKP" (user identifier)
 * - Position 11-17: varies (random)
 *
 * Let's test if the API accepts IDs with this structure.
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";
import { getToken, gmailFetch } from "../token-api";
import { listAccounts } from "../accounts";

const CDP_PORT = 9333;
const SUPERHUMAN_BACKEND_BASE = "https://mail.superhuman.com/~backend";

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomChars(len: number): string {
  let result = '';
  for (let i = 0; i < len; i++) {
    result += BASE62.charAt(Math.floor(Math.random() * BASE62.length));
  }
  return result;
}

// Generate event ID with the discovered format
function generateEventId(userPrefix: string): string {
  // Format: 11V + 4 random chars + userPrefix + 7 random chars
  const formatPrefix = '11V';
  const midSection = randomChars(4);
  const randomSuffix = randomChars(7);

  return `event_${formatPrefix}${midSection}${userPrefix}${randomSuffix}`;
}

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(CDP_PORT);

  if (!conn) {
    console.error("Failed to connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  // Get account info
  const accounts = await listAccounts(conn);
  const currentAccount = accounts.find((a) => a.isCurrent);
  if (!currentAccount) {
    console.error("No current account");
    process.exit(1);
  }

  console.log(`Current account: ${currentAccount.email}`);

  // Extract the user prefix from userId
  const userPrefixResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const userId = ga?.labels?._settings?._cache?.userId;
        if (!userId) return null;
        const suffix = userId.replace('user_', '');
        return suffix.substring(7, 11);
      })()
    `,
    returnByValue: true,
  });

  const userPrefix = userPrefixResult.result.value;
  if (!userPrefix) {
    console.error("Could not extract user prefix");
    process.exit(1);
  }

  console.log(`User prefix: ${userPrefix}`);

  // Get idToken for auth
  const tokenResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        return ga?.credential?._authData?.idToken;
      })()
    `,
    returnByValue: true,
  });

  const idToken = tokenResult.result.value;
  if (!idToken) {
    console.error("Could not get idToken");
    process.exit(1);
  }

  // Get OAuth token for Gmail
  const oauthToken = await getToken(conn, currentAccount.email);

  // Get a recent thread
  const threadsResult = await gmailFetch(oauthToken.accessToken, '/threads?maxResults=1');
  if (!threadsResult?.threads?.[0]) {
    console.error("Could not get threads");
    process.exit(1);
  }

  const threadId = threadsResult.threads[0].id;
  console.log(`Using thread: ${threadId}`);

  // Get thread content
  const thread = await gmailFetch(oauthToken.accessToken, `/threads/${threadId}?format=full`);
  if (!thread?.messages) {
    console.error("Could not get thread content");
    process.exit(1);
  }

  // Build thread messages
  const threadMessages = thread.messages.map((msg: any) => {
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

  console.log(`Thread has ${threadMessages.length} messages`);

  // Generate event ID with user prefix
  const eventId = generateEventId(userPrefix);
  console.log(`Generated event ID: ${eventId}`);

  // Build payload
  const payload = {
    session_id: crypto.randomUUID(),
    question_event_id: eventId,
    query: "What is this email about? Summarize in one sentence.",
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

  console.log("\nCalling AI API...");

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

  try {
    const responseJson = JSON.parse(responseText);
    console.log("\nResponse:");
    console.log(JSON.stringify(responseJson, null, 2).substring(0, 2000));

    if (responseJson.response || responseJson.answer) {
      console.log("\n=== SUCCESS! The AI responded! ===");
    } else if (responseJson.error || responseJson.code !== 200) {
      console.log("\n=== API returned an error ===");
    }
  } catch {
    console.log("\nRaw response:", responseText.substring(0, 1000));
  }

  await disconnect(conn);
}

main().catch(console.error);
