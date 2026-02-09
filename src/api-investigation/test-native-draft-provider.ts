#!/usr/bin/env bun
/**
 * Debug script to test SuperhumanDraftProvider directly
 */

import { SuperhumanDraftProvider } from "../providers/superhuman-draft-provider";
import { loadTokensFromDisk, getCachedToken } from "../token-api";

async function testNativeDrafts() {
  console.log("Loading tokens...");
  await loadTokensFromDisk();
  
  const email = "eddyhu@gmail.com";
  const token = await getCachedToken(email);
  
  if (!token) {
    console.error("No token found for", email);
    process.exit(1);
  }
  
  console.log(`Testing SuperhumanDraftProvider for ${email}`);
  console.log(`Token: ${token.accessToken.substring(0, 20)}...`);
  
  const provider = new SuperhumanDraftProvider(token);
  
  try {
    console.log("\nCalling provider.listDrafts()...");
    const drafts = await provider.listDrafts();
    
    console.log(`\nFound ${drafts.length} native drafts:`);
    for (const draft of drafts) {
      console.log(`  - ${draft.id}: ${draft.subject || "(no subject)"}`);
      console.log(`    Source: ${draft.source}`);
      console.log(`    To: ${draft.to.join(", ")}`);
      console.log("");
    }
  } catch (error) {
    console.error("Error fetching drafts:", error);
    if (error instanceof Error) {
      console.error("Stack:", error.stack);
    }
  }
}

testNativeDrafts();
