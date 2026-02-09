#!/usr/bin/env bun
/**
 * Monitor Superhuman API calls for drafts WITH RESPONSES
 */

import { connectToSuperhuman } from "../superhuman-api";

async function monitorDraftsAPI() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333, false);
  if (!conn) {
    console.error("Failed to connect");
    process.exit(1);
  }

  console.log("Connected. Monitoring network requests...");

  // Enable Network domain
  await conn.Network.enable();

  const requestMap = new Map();

  // Listen for requests
  conn.Network.requestWillBeSent((params: any) => {
    const url = params.request.url;
    if (url.includes('userdata') && url.includes('getThreads')) {
      console.log('\n📡 Request:', url);
      if (params.request.postData) {
        try {
          const body = JSON.parse(params.request.postData);
          console.log('   Body:', JSON.stringify(body, null, 2));
          
          // Store request ID to match with response
          if (body.filter?.type === 'draft') {
            requestMap.set(params.requestId, { url, body });
          }
        } catch (e) {
          console.log('   Body (raw):', params.request.postData);
        }
      }
    }
  });

  // Listen for responses
  conn.Network.responseReceived(async (params: any) => {
    if (requestMap.has(params.requestId)) {
      const req = requestMap.get(params.requestId);
      console.log('\n✅ Response for:', req.url);
      
      try {
        // Get response body
        const response = await conn.Network.getResponseBody({ requestId: params.requestId });
        const body = JSON.parse(response.body);
        console.log('   Response:', JSON.stringify(body, null, 2));
      } catch (e) {
        console.log('   Could not get response body:', e.message);
      }
    }
  });

  console.log("\n🎯 Instructions:");
  console.log("1. In Superhuman, press Cmd+K (or Ctrl+K)");
  console.log("2. Type 'drafts' and navigate to the Drafts view");
  console.log("3. Wait a few seconds");
  console.log("4. Press Ctrl+C to exit\n");
  console.log("Monitoring...\n");

  // Wait for user to navigate
  await new Promise(() => {}); // Infinite wait until Ctrl+C
}

monitorDraftsAPI();
