#!/usr/bin/env bun
/**
 * Debug script - log raw API response
 */

import { loadTokensFromDisk, getCachedToken } from "../token-api";

async function debugAPI() {
  await loadTokensFromDisk();
  
  const email = "eddyhu@gmail.com";
  const token = await getCachedToken(email);
  
  if (!token) {
    console.error("No token");
    process.exit(1);
  }
  
  const authToken = token.superhumanToken?.token;
  if (!authToken) {
    console.error("No superhumanToken");
    process.exit(1);
  }
  
  console.log("Calling userdata.getThreads with superhumanToken...\n");
  console.log("Token:", authToken.substring(0, 50) + "...\n");
  
  const response = await fetch("https://mail.superhuman.com/~backend/v3/userdata.getThreads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: { type: "draft" },
      offset: 0,
      limit: 25,
    }),
  });

  console.log("Status:", response.status);
  console.log("OK:", response.ok);
  
  const data = await response.json();
  console.log("\nRaw response:");
  console.log(JSON.stringify(data, null, 2));
}

debugAPI();
