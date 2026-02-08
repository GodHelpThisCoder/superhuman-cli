/**
 * Test Superhuman AI API with team-prefixed event ID
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";
import { getToken, gmailFetch } from "../token-api";
import { listAccounts } from "../accounts";

const CDP_PORT = 9333;
const SUPERHUMAN_BACKEND_BASE = "https://mail.superhuman.com/~backend";

// Generate event ID matching Superhuman's format
// Format: event_ + team prefix (first chars after team_) + random alphanumeric
function generateEventId(teamId: string): string {
  // Extract prefix from team ID (e.g., "11STeHt1wOE5UlznX9" from "team_11STeHt1wOE5UlznX9")
  const teamSuffix = teamId.replace("team_", "");
  const prefix = teamSuffix.substring(0, 2); // Get "11"

  // Generate 15 more random chars (mixed case alphanumeric) to total ~17 after prefix
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 15; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `event_${prefix}${suffix}`;
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

  // Get idToken, googleId, and pseudoTeamId
  const tokenResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const authData = ga?.credential?._authData;
        const pseudoTeamId = ga?.accountStore?.state?.account?.settings?._cache?.pseudoTeamId;

        return {
          idToken: authData?.idToken,
          googleId: authData?.googleId,
          pseudoTeamId,
        };
      })()
    `,
    returnByValue: true,
  });

  const { idToken, googleId, pseudoTeamId } = tokenResult.result.value;
  console.log("Pseudo Team ID:", pseudoTeamId);

  // Generate event ID with team prefix
  const eventId = generateEventId(pseudoTeamId);
  console.log("Generated event ID:", eventId);
  console.log("Expected format:    event_11VNPdc4sKP2pEaKSz");

  // Get OAuth token for Gmail
  const oauthToken = await getToken(conn, currentAccount.email);

  // Get thread for context
  const threadId = "19b4d2a9561472a1";
  console.log("\nFetching thread:", threadId);

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
      body: body.substring(0, 5000),
    };
  });

  console.log("Thread has", threadMessages.length, "messages");

  const payload = {
    session_id: crypto.randomUUID(),
    question_event_id: eventId,
    query: "summarize this thread in 2 sentences",
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

  console.log("\nCalling AI API...");

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
    console.log("\nResponse:", JSON.stringify(responseJson, null, 2).substring(0, 2000));
  } catch {
    console.log("\nResponse:", responseText.substring(0, 1000));
  }

  await disconnect(conn);
}

main().catch(console.error);
