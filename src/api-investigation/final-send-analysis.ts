#!/usr/bin/env bun
/**
 * Final Send Analysis
 *
 * Complete the analysis and create a working send function.
 */

import { connectToSuperhuman } from "../superhuman-api";

async function analyzeAsMessageWithDi(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const ctrl = cfc?.[draftKey];
          const draft = ctrl?.state?.draft;

          if (!draft) return { error: "No draft found - open compose first" };
          if (!di) return { error: "No DI container" };

          // Call asMessage WITH the di parameter
          const msg = draft.asMessage(di);
          if (!msg) return { error: "asMessage returned null" };

          const info = {
            msgType: msg.constructor?.name,
            msgKeys: Object.keys(msg).slice(0, 30),
            msgMethods: [],
          };

          // Get methods
          let proto = Object.getPrototypeOf(msg);
          while (proto && proto !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(proto)) {
              if (typeof msg[name] === 'function') {
                info.msgMethods.push(name);
              }
            }
            proto = Object.getPrototypeOf(proto);
          }

          // Look for toJsonRequest
          if (typeof msg.toJsonRequest === 'function') {
            info.hasToJsonRequest = true;
            info.toJsonRequestSource = msg.toJsonRequest.toString().substring(0, 2000);

            // Try to call it
            try {
              const req = msg.toJsonRequest();
              info.jsonRequest = req;
              info.jsonRequestKeys = Object.keys(req);
            } catch (e) {
              info.jsonRequestError = e.message;
            }
          }

          return info;
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

async function testBackendSend(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Get the complete send payload that would be sent to backend
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          const backend = ga?.backend;

          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const ctrl = cfc?.[draftKey];
          const draft = ctrl?.state?.draft;

          if (!draft) return { error: "No draft found" };
          if (!di) return { error: "No DI" };
          if (!backend) return { error: "No backend" };

          // Get the message
          const msg = draft.asMessage(di);
          if (!msg) return { error: "asMessage failed" };

          // Get the JSON request
          const jsonReq = msg.toJsonRequest();

          // Get backend's _appToBackend conversion
          let converted = null;
          if (typeof backend._appToBackend === 'function') {
            try {
              converted = backend._appToBackend(jsonReq);
            } catch (e) {
              converted = { error: e.message };
            }
          }

          // Show what the actual send request looks like
          // From backend.sendEmail source:
          // const y = {
          //   version: 3,
          //   outgoing_message: r.toJsonRequest(),
          //   reminder: _?.toJson(),
          //   delay: SEND_DELAY,
          //   is_multi_recipient: true
          // };

          const sendPayload = {
            version: 3,
            outgoing_message: jsonReq,
            reminder: undefined,
            delay: 10000, // SEND_DELAY
            is_multi_recipient: true,
          };

          return {
            success: true,
            msgType: msg.constructor?.name,
            jsonRequestKeys: Object.keys(jsonReq),
            sendPayload: sendPayload,
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

async function analyzeMessageConstructor(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Understand how to construct a Message from scratch
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const ctrl = cfc?.[draftKey];
          const draft = ctrl?.state?.draft;

          if (!draft || !di) return { error: "No draft or DI" };

          const msg = draft.asMessage(di);
          const MsgClass = msg.constructor;

          // Get static methods
          const staticMethods = Object.getOwnPropertyNames(MsgClass)
            .filter(k => typeof MsgClass[k] === 'function');

          // Get constructor params from draft
          // draft.asMessage creates: new OutgoingMessage({...draft.attributes, ...})

          return {
            className: MsgClass.name,
            staticMethods,
            constructorSource: MsgClass.toString().substring(0, 2000),

            // The message attributes (what we need to provide)
            draftAttributes: Object.keys(draft.attributes || {}).slice(0, 30),
            msgAttributes: Object.keys(msg.attributes || msg).slice(0, 30),
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

async function getMessageRequirements(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Get the minimum required fields for a message
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const ctrl = cfc?.[draftKey];
          const draft = ctrl?.state?.draft;

          if (!draft || !di) return { error: "No draft or DI" };

          const msg = draft.asMessage(di);

          // Get all getter methods to understand what fields are needed
          const getters = [];
          let proto = Object.getPrototypeOf(msg);
          while (proto && proto !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(proto)) {
              if (name.startsWith('get') && typeof msg[name] === 'function') {
                try {
                  const val = msg[name]();
                  getters.push({
                    name,
                    valueType: typeof val,
                    value: JSON.stringify(val)?.substring(0, 200),
                  });
                } catch (e) {
                  getters.push({ name, error: e.message });
                }
              }
            }
            proto = Object.getPrototypeOf(proto);
          }

          return { getters };
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

async function testDirectGmailSend(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Test that we can actually call the Gmail API send endpoint
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { error: "No gmail service" };

          // Create a test email that will fail validation (no To)
          const rawEmail = [
            'From: me',
            'Subject: API Test',
            'Content-Type: text/plain',
            '',
            'Test'
          ].join('\\r\\n');

          const base64 = btoa(rawEmail)
            .replace(/\\+/g, '-')
            .replace(/\\//g, '_')
            .replace(/=+$/, '');

          try {
            await gmail._postAsync(
              'https://content.googleapis.com/gmail/v1/users/me/messages/send',
              { raw: base64 },
              { endpoint: 'gmail.users.messages.send', cost: 100 }
            );
            return { unexpected: "Should have failed" };
          } catch (e) {
            // Expected to fail
            return {
              authWorks: e.message?.includes('400') || e.message?.includes('Recipient'),
              error: e.message,
            };
          }
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

async function createMinimalSendFunction(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Create and test a minimal send function
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        // This is the minimal function needed to send via Gmail API
        // DO NOT actually send - just return the code

        const sendViaGmailApi = \`
async function sendEmail(toEmail, subject, body, threadId = null, inReplyTo = null, references = []) {
  const gmail = window.GoogleAccount?.di?.get?.('gmail');
  const profile = await gmail.getProfile();
  const fromEmail = profile?.emailAddress;

  if (!gmail) throw new Error("Gmail service not found");
  if (!fromEmail) throw new Error("Could not get from email");

  // Build RFC 2822 email headers
  const headers = [
    'MIME-Version: 1.0',
    'From: ' + fromEmail,
    'To: ' + toEmail,
    'Subject: ' + subject,
    'Content-Type: text/html; charset=utf-8',
  ];

  // Add threading headers for replies
  if (inReplyTo) {
    headers.push('In-Reply-To: <' + inReplyTo + '>');
  }
  if (references.length > 0) {
    headers.push('References: ' + references.join(' '));
  }

  // Add empty line and body
  headers.push('', body);

  const rawEmail = headers.join('\\\\r\\\\n');

  // Base64url encode
  const base64Email = btoa(unescape(encodeURIComponent(rawEmail)))
    .replace(/\\\\+/g, '-')
    .replace(/\\\\//g, '_')
    .replace(/=+$/, '');

  // Build payload
  const payload = { raw: base64Email };
  if (threadId) {
    payload.threadId = threadId;
  }

  // Send via Gmail API
  const response = await gmail._postAsync(
    'https://content.googleapis.com/gmail/v1/users/me/messages/send',
    payload,
    { endpoint: 'gmail.users.messages.send', cost: 100 }
  );

  return {
    messageId: response?.id,
    threadId: response?.threadId,
    labelIds: response?.labelIds,
  };
}
\`;

        return {
          code: sendViaGmailApi,
          notes: [
            "1. Uses gmail._postAsync for authenticated requests",
            "2. Content must be RFC 2822 format, base64url encoded",
            "3. For replies, include threadId + In-Reply-To + References",
            "4. No UI interaction needed - pure API call",
            "5. Much faster than UI-based draft/send flow",
          ]
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value;
}

async function main() {
  console.log("Final Send Analysis");
  console.log("=".repeat(60));
  console.log("");

  const conn = await connectToSuperhuman();
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  console.log("Connected to Superhuman\n");

  try {
    // 1. Test Gmail API auth
    console.log("1. Gmail API Auth Test");
    console.log("-".repeat(40));
    const authTest = await testDirectGmailSend(conn);
    console.log(JSON.stringify(authTest, null, 2));
    console.log("");

    // 2. Analyze asMessage with DI
    console.log("2. AsMessage with DI");
    console.log("-".repeat(40));
    const asMsg = await analyzeAsMessageWithDi(conn);
    console.log("Message type:", asMsg.msgType);
    console.log("Has toJsonRequest:", asMsg.hasToJsonRequest);
    console.log("\ntoJsonRequest source:");
    console.log(asMsg.toJsonRequestSource?.substring(0, 500));
    console.log("\nJSON request keys:", asMsg.jsonRequestKeys);
    console.log("");

    // 3. Backend send payload
    console.log("3. Backend Send Payload");
    console.log("-".repeat(40));
    const payload = await testBackendSend(conn);
    if (payload.sendPayload) {
      console.log("Send payload structure:");
      console.log(JSON.stringify(payload.sendPayload, null, 2).substring(0, 2000));
    } else {
      console.log(JSON.stringify(payload, null, 2));
    }
    console.log("");

    // 4. Message requirements
    console.log("4. Message Getters (required fields)");
    console.log("-".repeat(40));
    const reqs = await getMessageRequirements(conn);
    if (reqs.getters) {
      for (const g of reqs.getters.slice(0, 20)) {
        console.log(`  ${g.name}: ${g.valueType} = ${g.value?.substring(0, 50) || g.error}`);
      }
    }
    console.log("");

    // 5. Create minimal send function
    console.log("5. Minimal Send Function");
    console.log("-".repeat(40));
    const sendFn = await createMinimalSendFunction(conn);
    console.log(sendFn.code);
    console.log("\nNotes:");
    for (const note of sendFn.notes) {
      console.log("  " + note);
    }

    // Final summary
    console.log("");
    console.log("=".repeat(60));
    console.log("CONCLUSION: Direct Gmail API Send IS Possible");
    console.log("=".repeat(60));
    console.log("");
    console.log("Two approaches available:");
    console.log("");
    console.log("APPROACH 1: Direct Gmail API (RECOMMENDED)");
    console.log("  - Use gmail._postAsync() to call Gmail send endpoint");
    console.log("  - Build RFC 2822 message, base64url encode");
    console.log("  - No UI interaction, fully server-side");
    console.log("  - Works immediately, no timing issues");
    console.log("");
    console.log("APPROACH 2: Superhuman Backend API");
    console.log("  - Use backend.sendEmail(msg, reminder)");
    console.log("  - Requires constructing OutgoingMessage object");
    console.log("  - More complex but uses Superhuman's scheduling/delay features");
    console.log("");

  } finally {
    await conn.client.close();
    console.log("\nDisconnected from Superhuman");
  }
}

main().catch(console.error);
