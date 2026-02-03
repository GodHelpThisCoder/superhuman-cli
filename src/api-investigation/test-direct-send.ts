#!/usr/bin/env bun
/**
 * Test Direct Gmail API Send
 *
 * Tests sending an email directly via the Gmail API, bypassing Superhuman's UI.
 * Also explores the backend.sendEmail() method.
 */

import { connectToSuperhuman } from "../superhuman-api";

async function exploreBackendSendEmail(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const backend = window.GoogleAccount?.backend;
          if (!backend) return { error: "backend not found" };

          // Get sendEmail method details
          const sendEmail = backend.sendEmail;
          if (!sendEmail) return { error: "sendEmail not found" };

          return {
            found: true,
            methodLength: sendEmail.length,
            source: sendEmail.toString().substring(0, 2000),
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function analyzeAppToBackendDraft(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const backend = window.GoogleAccount?.backend;
          if (!backend) return { error: "backend not found" };

          return {
            _appToBackendDraft: backend._appToBackendDraft?.toString().substring(0, 2000),
            _backendToAppSendJob: backend._backendToAppSendJob?.toString().substring(0, 1000),
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function testSendViaGmailApi(
  conn: { Runtime: any },
  toEmail: string,
  subject: string,
  body: string
) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          const profile = await gmail.getProfile();
          const fromEmail = profile?.emailAddress;

          if (!gmail) return { error: "gmail not found" };
          if (!fromEmail) return { error: "Could not get from email" };

          // Build RFC 2822 email content
          const toEmail = ${JSON.stringify(toEmail)};
          const subject = ${JSON.stringify(subject)};
          const body = ${JSON.stringify(body)};

          const emailLines = [
            'MIME-Version: 1.0',
            'From: ' + fromEmail,
            'To: ' + toEmail,
            'Subject: ' + subject,
            'Content-Type: text/plain; charset=utf-8',
            '',
            body
          ];

          const rawEmail = emailLines.join('\\r\\n');

          // Base64url encode the email
          const base64Email = btoa(unescape(encodeURIComponent(rawEmail)))
            .replace(/\\+/g, '-')
            .replace(/\\//g, '_')
            .replace(/=+$/, '');

          // Send via Gmail API
          const response = await gmail._postAsync(
            'https://content.googleapis.com/gmail/v1/users/me/messages/send',
            { raw: base64Email },
            { endpoint: 'gmail.users.messages.send', cost: 100 }
          );

          return {
            success: true,
            messageId: response?.id,
            threadId: response?.threadId,
            labelIds: response?.labelIds,
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

async function testReplyViaGmailApi(
  conn: { Runtime: any },
  threadId: string,
  toEmail: string,
  subject: string,
  body: string,
  inReplyTo?: string,
  references?: string[]
) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          const profile = await gmail.getProfile();
          const fromEmail = profile?.emailAddress;

          if (!gmail) return { error: "gmail not found" };
          if (!fromEmail) return { error: "Could not get from email" };

          const toEmail = ${JSON.stringify(toEmail)};
          const subject = ${JSON.stringify(subject)};
          const body = ${JSON.stringify(body)};
          const threadId = ${JSON.stringify(threadId)};
          const inReplyTo = ${JSON.stringify(inReplyTo || "")};
          const references = ${JSON.stringify(references || [])};

          // Build headers
          const headers = [
            'MIME-Version: 1.0',
            'From: ' + fromEmail,
            'To: ' + toEmail,
            'Subject: ' + subject,
            'Content-Type: text/plain; charset=utf-8',
          ];

          // Add threading headers if available
          if (inReplyTo) {
            headers.push('In-Reply-To: <' + inReplyTo + '>');
          }
          if (references && references.length > 0) {
            headers.push('References: ' + references.join(' '));
          }

          headers.push('', body);

          const rawEmail = headers.join('\\r\\n');
          const base64Email = btoa(unescape(encodeURIComponent(rawEmail)))
            .replace(/\\+/g, '-')
            .replace(/\\//g, '_')
            .replace(/=+$/, '');

          // Send with threadId to add to existing thread
          const response = await gmail._postAsync(
            'https://content.googleapis.com/gmail/v1/users/me/messages/send',
            { raw: base64Email, threadId: threadId },
            { endpoint: 'gmail.users.messages.send', cost: 100 }
          );

          return {
            success: true,
            messageId: response?.id,
            threadId: response?.threadId,
            labelIds: response?.labelIds,
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

async function getThreadForReply(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const threadList = window.ViewState?.threadListState?._list?._sortedList?.sorted;

          if (!threadList || threadList.length === 0) {
            return { error: "No threads found" };
          }

          // Find a thread we can reply to
          for (const ref of threadList.slice(0, 5)) {
            const thread = ga?.threads?.identityMap?.get?.(ref.id);
            if (!thread?._threadModel) continue;

            const model = thread._threadModel;
            const messages = model.messages || [];

            // Find the last message that's NOT from us
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i];
              const fromEmail = msg.from?.email;

              if (fromEmail && !fromEmail.includes('@gmail.com')) {
                // This is a message from someone else
                return {
                  found: true,
                  threadId: model.id,
                  subject: model.subject,
                  replyTo: fromEmail,
                  messageId: msg.rawJson?.messageId || msg.rawJson?.rfc822Id,
                  references: msg.rawJson?.references || [],
                };
              }
            }

            // If no external sender, just return the thread info
            const lastMsg = messages[messages.length - 1];
            return {
              found: true,
              threadId: model.id,
              subject: model.subject,
              replyTo: lastMsg?.from?.email || 'unknown',
              messageId: lastMsg?.rawJson?.messageId || lastMsg?.rawJson?.rfc822Id,
              references: lastMsg?.rawJson?.references || [],
            };
          }

          return { error: "No suitable thread found" };
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
  console.log("Test Direct Gmail API Send");
  console.log("=".repeat(60));
  console.log("");

  const args = process.argv.slice(2);
  const dryRun = !args.includes("--send");
  const testReply = args.includes("--reply");

  if (dryRun) {
    console.log("DRY RUN MODE - No emails will be sent");
    console.log("Use --send to actually send a test email");
    console.log("Use --reply to test reply functionality");
    console.log("");
  }

  const conn = await connectToSuperhuman();
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  console.log("Connected to Superhuman\n");

  try {
    // 1. Explore backend.sendEmail
    console.log("1. Backend sendEmail Method");
    console.log("-".repeat(40));
    const sendEmailInfo = await exploreBackendSendEmail(conn);
    console.log("Source code:");
    console.log(sendEmailInfo.source || sendEmailInfo.error);
    console.log("");

    // 2. Explore draft conversion methods
    console.log("2. Draft Conversion Methods");
    console.log("-".repeat(40));
    const draftMethods = await analyzeAppToBackendDraft(conn);
    console.log("_appToBackendDraft:");
    console.log(draftMethods._appToBackendDraft?.substring(0, 1000) || "(not found)");
    console.log("");

    // 3. Get thread for reply test
    console.log("3. Get Thread for Reply Test");
    console.log("-".repeat(40));
    const threadInfo = await getThreadForReply(conn);
    console.log(JSON.stringify(threadInfo, null, 2));
    console.log("");

    if (!dryRun) {
      if (testReply && threadInfo.found) {
        // 4. Test reply via Gmail API
        console.log("4. Testing Reply via Gmail API");
        console.log("-".repeat(40));

        const testSubject = threadInfo.subject?.startsWith("Re:")
          ? threadInfo.subject
          : "Re: " + threadInfo.subject;

        const testBody = `This is a test reply sent directly via Gmail API at ${new Date().toISOString()}`;

        console.log("Sending reply to:", threadInfo.replyTo);
        console.log("Subject:", testSubject);
        console.log("ThreadId:", threadInfo.threadId);

        const replyResult = await testReplyViaGmailApi(
          conn,
          threadInfo.threadId,
          threadInfo.replyTo,
          testSubject,
          testBody,
          threadInfo.messageId,
          threadInfo.references
        );

        console.log("\nResult:", JSON.stringify(replyResult, null, 2));
      } else {
        // 4. Test send via Gmail API
        console.log("4. Testing Send via Gmail API");
        console.log("-".repeat(40));

        const testEmail = "eddyhu@gmail.com"; // Send to self for testing
        const testSubject = "Direct Gmail API Test - " + new Date().toISOString();
        const testBody = "This email was sent directly via the Gmail API, bypassing Superhuman's UI-based draft system.";

        console.log("Sending test email to:", testEmail);

        const sendResult = await testSendViaGmailApi(
          conn,
          testEmail,
          testSubject,
          testBody
        );

        console.log("\nResult:", JSON.stringify(sendResult, null, 2));
      }
    }

    // Summary
    console.log("");
    console.log("=".repeat(60));
    console.log("CONCLUSION");
    console.log("=".repeat(60));
    console.log("");
    console.log("Direct Gmail API sending IS possible using:");
    console.log("");
    console.log("  gmail._postAsync(");
    console.log("    'https://content.googleapis.com/gmail/v1/users/me/messages/send',");
    console.log("    { raw: base64urlEncodedRfc2822Message },");
    console.log("    { endpoint: 'gmail.users.messages.send', cost: 100 }");
    console.log("  )");
    console.log("");
    console.log("For replies, include threadId in the payload:");
    console.log("  { raw: ..., threadId: existingThreadId }");
    console.log("");
    console.log("The raw field must be a base64url-encoded RFC 2822 email.");

  } finally {
    await conn.client.close();
    console.log("\nDisconnected from Superhuman");
  }
}

main().catch(console.error);
