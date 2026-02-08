/**
 * Test Superhuman AI API with CUID-style event ID
 */

import { createId, init } from "@paralleldrive/cuid2";
import { connectToSuperhuman, disconnect } from "../superhuman-api";
import { getToken, gmailFetch } from "../token-api";
import { listAccounts } from "../accounts";

const CDP_PORT = 9333;
const SUPERHUMAN_BACKEND_BASE = "https://mail.superhuman.com/~backend";

async function main() {
  console.log("Testing CUID generation:");
  console.log("  Sample CUID:", createId());
  console.log("  Expected format: event_11VNPdc4sKP2pEaKSz");

  // Create a custom CUID generator with length 17 (to match Superhuman's format)
  const generateId = init({
    length: 17,
  });

  const eventId = `event_${generateId()}`;
  console.log("  Generated event ID:", eventId);

  console.log("\nConnecting to Superhuman...");
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

  // Get thread for context
  const threadId = "19b4d2a9561472a1";
  console.log("Fetching thread:", threadId);

  const thread = await gmailFetch(oauthToken.accessToken, `/threads/${threadId}?format=full`);
  if (!thread || !thread.messages) {
    console.error("Failed to fetch thread");
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
      body: body.substring(0, 5000), // Limit body size
    };
  });

  const payload = {
    session_id: crypto.randomUUID(),
    question_event_id: eventId,
    query: "summarize this thread",
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

  console.log("\nCalling AI API with event ID:", eventId);

  const response = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.askAIProxy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log("Response status:", response.status);
  const responseText = await response.text();

  try {
    const responseJson = JSON.parse(responseText);
    console.log("Response:", JSON.stringify(responseJson, null, 2).substring(0, 1500));
  } catch {
    console.log("Response:", responseText.substring(0, 500));
  }

  await disconnect(conn);
}

main().catch(console.error);
