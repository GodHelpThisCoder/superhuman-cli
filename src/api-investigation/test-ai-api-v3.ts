/**
 * Test Superhuman AI API v3 - using team ID prefix pattern
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";
import { getToken, gmailFetch } from "../token-api";
import { listAccounts } from "../accounts";

const CDP_PORT = 9333;
const SUPERHUMAN_BACKEND_BASE = "https://mail.superhuman.com/~backend";

// Generate event ID using Superhuman's pattern
function generateEventIdWithPrefix(prefix: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = `event_${prefix}`;
  // After the prefix, add ~14 more chars to reach ~17 total after event_
  const remainingChars = 17 - prefix.length;
  for (let i = 0; i < remainingChars; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
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

  // Get idToken and team info
  const tokenResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const authData = ga?.credential?._authData;
        const di = ga?.di;

        // Try to find team ID
        let teamId = null;
        try {
          const team = di?.get('team');
          teamId = team?.id || team?.teamId;
        } catch {}

        // Also check for direct teamId
        teamId = teamId || ga?.teamId;

        // Get the ID prefix from team
        let prefix = null;
        if (teamId && teamId.startsWith('team_')) {
          // Extract the part after team_ (e.g., "11STeHt1wOE5UlznX9" from "team_11STeHt1wOE5UlznX9")
          const fullPrefix = teamId.substring(5); // Remove "team_"
          // Take just the numeric/alphanumeric prefix portion
          prefix = fullPrefix.substring(0, 2); // Take first 2 chars "11"
        }

        return {
          idToken: authData?.idToken,
          googleId: authData?.googleId,
          teamId,
          prefix,
        };
      })()
    `,
    returnByValue: true,
  });

  const { idToken, googleId, teamId, prefix } = tokenResult.result.value;
  console.log("Team ID:", teamId);
  console.log("Prefix:", prefix);

  // Get OAuth token for Gmail
  const oauthToken = await getToken(conn, currentAccount.email);

  // Get a thread for context
  const threadId = "19b4d2a9561472a1";
  console.log("\nFetching thread:", threadId);

  const threadPath = `/threads/${threadId}?format=full`;
  const thread = await gmailFetch(oauthToken.accessToken, threadPath);

  if (!thread || !thread.messages) {
    console.error("Failed to fetch thread");
    process.exit(1);
  }

  // Build thread messages for AI
  const threadMessages = thread.messages.map((msg: any) => {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

    let body = "";
    function extractBody(part: any): void {
      if (part.mimeType === "text/plain" && part.body?.data) {
        body = Buffer.from(part.body.data, "base64url").toString("utf-8");
      } else if (part.mimeType === "text/html" && part.body?.data && !body) {
        const htmlBody = Buffer.from(part.body.data, "base64url").toString("utf-8");
        body = htmlBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
      if (part.parts) {
        for (const p of part.parts) extractBody(p);
      }
    }
    extractBody(msg.payload);

    return {
      message_id: msg.id,
      subject: getHeader("Subject"),
      body: body || msg.snippet || "",
    };
  });

  // Generate event ID with the prefix from team ID
  const eventId = prefix ? generateEventIdWithPrefix(prefix) : `event_${Math.random().toString(36).slice(2, 19)}`;
  console.log("Generated event ID:", eventId);

  const payload = {
    session_id: crypto.randomUUID(),
    question_event_id: eventId,
    query: "summarize this thread in one sentence",
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
    console.log("Response:", JSON.stringify(responseJson, null, 2).substring(0, 2000));
  } catch {
    console.log("Response (raw):", responseText.substring(0, 500));
  }

  await disconnect(conn);
}

main().catch(console.error);
