/**
 * Test the updated askAI function in token-api.ts
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";
import {
  getToken,
  extractUserPrefix,
  askAI,
  getSuperhumanToken,
  gmailFetch,
} from "../token-api";
import { listAccounts } from "../accounts";

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

    if (!userPrefix) {
      console.error("Could not extract user prefix");
      process.exit(1);
    }

    // Get tokens
    const oauthToken = await getToken(conn, currentAccount.email);
    console.log(`OAuth token obtained`);

    const superhumanTokenInfo = await getSuperhumanToken(conn, currentAccount.email);
    if (!superhumanTokenInfo?.token) {
      console.error("Could not get Superhuman token");
      process.exit(1);
    }
    const superhumanToken = superhumanTokenInfo.token;
    console.log(`Superhuman token obtained`);

    // Get a recent thread
    const threadsResult = await gmailFetch(oauthToken.accessToken, "/threads?maxResults=1");
    if (!threadsResult?.threads?.[0]) {
      console.error("Could not get threads");
      process.exit(1);
    }

    const threadId = threadsResult.threads[0].id;
    console.log(`Using thread: ${threadId}`);

    // Call askAI with the user prefix
    console.log("\nCalling askAI...");
    const result = await askAI(
      superhumanToken,
      oauthToken,
      threadId,
      "What is this email about? Answer in one sentence.",
      {
        userPrefix,
        userEmail: currentAccount.email,
      }
    );

    console.log("\n=== AI Response ===");
    console.log(result.response);
    console.log(`\nSession ID: ${result.sessionId}`);

    console.log("\n=== SUCCESS! ===");
  } finally {
    await disconnect(conn);
  }
}

main().catch(console.error);
