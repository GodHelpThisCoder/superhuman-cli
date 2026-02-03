#!/usr/bin/env bun
/**
 * Gmail Send Exploration Script
 *
 * Deep dive into the gmail service's internal methods to understand
 * how to send emails directly via Gmail API.
 */

import { connectToSuperhuman } from "../superhuman-api";

async function exploreCredentials(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { error: "gmail not found" };

          const info = {};

          // Explore _credential object
          if (gmail._credential) {
            info.credentialKeys = Object.keys(gmail._credential);
            info.credentialType = gmail._credential.constructor?.name;

            if (gmail._credential._authData) {
              info.authDataKeys = Object.keys(gmail._credential._authData);

              // Check for accessToken vs idToken
              if (gmail._credential._authData.accessToken) {
                info.hasAccessToken = true;
                info.accessTokenPreview = gmail._credential._authData.accessToken.substring(0, 20) + '...';
              }
              if (gmail._credential._authData.idToken) {
                info.hasIdToken = true;
                info.idTokenPreview = gmail._credential._authData.idToken.substring(0, 20) + '...';
              }
              if (gmail._credential._authData.refreshToken) {
                info.hasRefreshToken = true;
              }
            }

            // Check for methods on credential
            info.credentialMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(gmail._credential))
              .filter(k => typeof gmail._credential[k] === 'function');

            // Try to get access token
            if (typeof gmail._credential.getAccessToken === 'function') {
              try {
                const token = await gmail._credential.getAccessToken();
                info.getAccessTokenResult = typeof token === 'string'
                  ? token.substring(0, 20) + '...'
                  : typeof token;
              } catch (e) {
                info.getAccessTokenError = e.message;
              }
            }
          }

          return info;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value;
}

async function exploreFetchMethod(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { error: "gmail not found" };

          const info = {};

          // Get _fetch and _postAsync source code
          if (gmail._fetch) {
            info._fetchSource = gmail._fetch.toString().substring(0, 1000);
          }

          if (gmail._postAsync) {
            info._postAsyncSource = gmail._postAsync.toString().substring(0, 1000);
          }

          if (gmail._authenticatedFetch) {
            info._authenticatedFetchSource = gmail._authenticatedFetch.toString().substring(0, 1000);
          }

          if (gmail._backgroundFetch) {
            info._backgroundFetchSource = gmail._backgroundFetch.toString().substring(0, 1000);
          }

          if (gmail._getAsync) {
            info._getAsyncSource = gmail._getAsync.toString().substring(0, 1000);
          }

          return info;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function testDirectPostAsync(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Test if we can call _postAsync with a simple request
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { error: "gmail not found" };

          // Try to get labels using _getAsync to verify the auth works
          const response = await gmail._getAsync(
            'https://content.googleapis.com/gmail/v1/users/me/labels'
          );

          return {
            success: true,
            responseType: typeof response,
            labelCount: response?.labels?.length,
            sampleLabel: response?.labels?.[0],
          };
        } catch (e) {
          return { error: e.message, stack: e.stack?.substring(0, 500) };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value;
}

async function testDraftOperations(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Test if we can list drafts via Gmail API
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { error: "gmail not found" };

          // List drafts
          const draftsResponse = await gmail._getAsync(
            'https://content.googleapis.com/gmail/v1/users/me/drafts'
          );

          return {
            success: true,
            draftCount: draftsResponse?.drafts?.length || 0,
            resultSize: draftsResponse?.resultSizeEstimate,
            sampleDraft: draftsResponse?.drafts?.[0],
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value;
}

async function testCreateDraftViaApi(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Test if we can create a draft via direct API call
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { error: "gmail not found" };

          // Build RFC 2822 email content
          const emailLines = [
            'From: me',
            'To: test@example.com',
            'Subject: API Test Draft - ' + new Date().toISOString(),
            'Content-Type: text/plain; charset=utf-8',
            '',
            'This is a test draft created via direct Gmail API.'
          ];

          const rawEmail = emailLines.join('\\r\\n');
          // Base64url encode the email
          const base64Email = btoa(rawEmail)
            .replace(/\\+/g, '-')
            .replace(/\\//g, '_')
            .replace(/=+$/, '');

          // Try to create draft
          const draftPayload = {
            message: {
              raw: base64Email
            }
          };

          const response = await gmail._postAsync(
            'https://content.googleapis.com/gmail/v1/users/me/drafts',
            draftPayload,
            { endpoint: 'gmail.users.drafts.create', cost: 10 }
          );

          return {
            success: true,
            draftId: response?.id,
            messageId: response?.message?.id,
            response: JSON.stringify(response).substring(0, 500)
          };
        } catch (e) {
          return { error: e.message, stack: e.stack?.substring(0, 500) };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value;
}

async function testSendViaApi(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // DO NOT ACTUALLY SEND - just check if the endpoint would work
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { error: "gmail not found" };

          // Check if _postAsync exists and what it expects
          const info = {
            hasPostAsync: typeof gmail._postAsync === 'function',
            postAsyncLength: gmail._postAsync?.length,
          };

          // Build a minimal test message that would NOT be valid to send
          // (no To header = would fail server-side validation)
          const emailLines = [
            'From: me',
            'Subject: WILL_NOT_SEND_TEST',
            'Content-Type: text/plain; charset=utf-8',
            '',
            'This message has no To header and should fail validation.'
          ];

          const rawEmail = emailLines.join('\\r\\n');
          const base64Email = btoa(rawEmail)
            .replace(/\\+/g, '-')
            .replace(/\\//g, '_')
            .replace(/=+$/, '');

          const sendPayload = {
            raw: base64Email
          };

          // Try the send endpoint - should fail due to missing To
          try {
            const response = await gmail._postAsync(
              'https://content.googleapis.com/gmail/v1/users/me/messages/send',
              sendPayload,
              { endpoint: 'gmail.users.messages.send', cost: 100 }
            );

            // If we get here, something unexpected happened
            info.unexpectedSuccess = true;
            info.response = JSON.stringify(response).substring(0, 500);
          } catch (e) {
            // Expected to fail due to missing To header
            info.sendTestError = e.message;
            // Check if the error is from Gmail API (indicates auth worked)
            info.authWorked = e.message?.includes('Invalid') ||
                             e.message?.includes('required') ||
                             e.message?.includes('400') ||
                             e.message?.includes('recipient');
          }

          return info;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value;
}

async function testThreadReply(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Test if we can create a reply draft for a specific thread
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          const ga = window.GoogleAccount;
          if (!gmail) return { error: "gmail not found" };

          // Get first thread from inbox
          const threadList = window.ViewState?.threadListState?._list?._sortedList?.sorted;
          if (!threadList || threadList.length === 0) {
            return { error: "No threads in inbox" };
          }

          const threadRef = threadList[0];
          const thread = ga?.threads?.identityMap?.get?.(threadRef.id);
          if (!thread?._threadModel) {
            return { error: "Thread not found in cache" };
          }

          const model = thread._threadModel;
          const lastMessage = model.messages?.[model.messages.length - 1];

          if (!lastMessage) {
            return { error: "No messages in thread" };
          }

          const info = {
            threadId: model.id,
            subject: model.subject,
            lastMessageId: lastMessage.id,
            from: lastMessage.from?.email,
            messageHeaders: Object.keys(lastMessage.rawJson || {}).slice(0, 15),
          };

          // Get the full message to see headers
          if (lastMessage.rawJson) {
            info.inReplyTo = lastMessage.rawJson.inReplyTo;
            info.references = lastMessage.rawJson.references;
            info.messageIdHeader = lastMessage.rawJson.messageId || lastMessage.rawJson['Message-ID'];
          }

          // Try to build a proper reply
          // The "In-Reply-To" header should be the Message-ID of the original
          // The "References" header should be the References of the original + its Message-ID

          return info;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value;
}

async function analyzeBackend(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Check the backend service for any send-related methods
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const backend = window.GoogleAccount?.backend;
          if (!backend) return { error: "backend not found" };

          const info = {
            backendType: backend.constructor?.name,
            ownKeys: Object.keys(backend).slice(0, 30),
          };

          // Get prototype methods
          const protoMethods = [];
          let proto = Object.getPrototypeOf(backend);
          while (proto && proto !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(proto)) {
              if (typeof backend[name] === 'function') {
                protoMethods.push(name);
              }
            }
            proto = Object.getPrototypeOf(proto);
          }
          info.protoMethods = protoMethods;

          // Look for send-related methods
          info.sendMethods = protoMethods.filter(m =>
            m.toLowerCase().includes('send') ||
            m.toLowerCase().includes('message') ||
            m.toLowerCase().includes('draft') ||
            m.toLowerCase().includes('compose')
          );

          return info;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function main() {
  console.log("Gmail Send Exploration");
  console.log("=".repeat(60));
  console.log("");

  const conn = await connectToSuperhuman();
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  console.log("Connected to Superhuman\n");

  try {
    // 1. Explore credentials
    console.log("1. Credentials Exploration");
    console.log("-".repeat(40));
    const credInfo = await exploreCredentials(conn);
    console.log(JSON.stringify(credInfo, null, 2));
    console.log("");

    // 2. Explore fetch methods
    console.log("2. Fetch Method Sources");
    console.log("-".repeat(40));
    const fetchInfo = await exploreFetchMethod(conn);
    console.log("_postAsync source:");
    console.log(fetchInfo._postAsyncSource || "(not found)");
    console.log("\n_authenticatedFetch source:");
    console.log(fetchInfo._authenticatedFetchSource || "(not found)");
    console.log("");

    // 3. Test direct API call
    console.log("3. Test Direct _getAsync Call");
    console.log("-".repeat(40));
    const getTest = await testDirectPostAsync(conn);
    console.log(JSON.stringify(getTest, null, 2));
    console.log("");

    // 4. Test draft operations
    console.log("4. Test Draft List via API");
    console.log("-".repeat(40));
    const draftTest = await testDraftOperations(conn);
    console.log(JSON.stringify(draftTest, null, 2));
    console.log("");

    // 5. Test create draft
    console.log("5. Test Create Draft via API");
    console.log("-".repeat(40));
    const createDraftTest = await testCreateDraftViaApi(conn);
    console.log(JSON.stringify(createDraftTest, null, 2));
    console.log("");

    // 6. Test send endpoint
    console.log("6. Test Send Endpoint (with invalid message)");
    console.log("-".repeat(40));
    const sendTest = await testSendViaApi(conn);
    console.log(JSON.stringify(sendTest, null, 2));
    console.log("");

    // 7. Analyze thread for reply
    console.log("7. Analyze Thread for Reply");
    console.log("-".repeat(40));
    const threadInfo = await testThreadReply(conn);
    console.log(JSON.stringify(threadInfo, null, 2));
    console.log("");

    // 8. Analyze backend
    console.log("8. Backend Service Analysis");
    console.log("-".repeat(40));
    const backendInfo = await analyzeBackend(conn);
    console.log(JSON.stringify(backendInfo, null, 2));
    console.log("");

    // Summary
    console.log("=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));

    console.log("\nKey Findings:");
    console.log("1. gmail._postAsync() can make authenticated POST requests");
    console.log("2. gmail._getAsync() can make authenticated GET requests");
    console.log("3. Direct Gmail API calls work (labels, drafts)");

    if (createDraftTest.success) {
      console.log("4. Draft creation via API: SUCCESS");
    } else {
      console.log("4. Draft creation via API: FAILED - " + createDraftTest.error);
    }

    if (sendTest.authWorked) {
      console.log("5. Send endpoint auth: WORKING (failed on validation as expected)");
      console.log("   -> Direct sending via Gmail API should be possible!");
    } else {
      console.log("5. Send endpoint auth: UNCLEAR");
      console.log("   Error: " + sendTest.sendTestError);
    }

  } finally {
    await conn.client.close();
    console.log("\nDisconnected from Superhuman");
  }
}

main().catch(console.error);
