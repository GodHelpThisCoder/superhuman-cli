import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Make the API call from within browser context with FIXED ID format
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const authData = ga?.credential?._authData;
          const user = ga?.credential?.user;
          const token = authData?.idToken;

          if (!token) {
            return { error: "No token" };
          }

          // Generate IDs - FIXED: 14 hex chars, not 16
          const genId = () => "draft00" + Array.from({ length: 14 }, () =>
            Math.floor(Math.random() * 16).toString(16)
          ).join("");

          const draftId = genId();
          const threadId = genId();
          const now = new Date().toISOString();
          const rfc822Prefix = Array.from({ length: 8 }, () =>
            "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
          ).join("");

          const requestBody = {
            writes: [{
              path: "users/" + user._id + "/threads/" + threadId + "/messages/" + draftId + "/draft",
              value: {
                id: draftId,
                threadId: threadId,
                action: "compose",
                name: null,
                from: user._name + " <" + ga.emailAddress + ">",
                cc: [],
                to: [],
                bcc: [],
                subject: "Test from in-browser " + Date.now(),
                body: "<p>Test</p>",
                snippet: "Test",
                inReplyToRfc822Id: null,
                labelIds: ["DRAFT"],
                clientCreatedAt: now,
                date: now,
                fingerprint: { to: "", cc: "", attachments: "" },
                lastSessionId: null,
                quotedContent: "",
                quotedContentInlined: false,
                references: [],
                reminder: null,
                rfc822Id: "<" + rfc822Prefix + "." + crypto.randomUUID() + "@we.are.superhuman.com>",
                scheduledFor: null,
                scheduledReplyInterruptedAt: null,
                schemaVersion: 3,
                totalComposeSeconds: 0,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
              }
            }]
          };

          console.log("Request body:", JSON.stringify(requestBody, null, 2));

          const response = await fetch("https://mail.superhuman.com/~backend/v3/userdata.writeMessage", {
            method: "POST",
            headers: {
              "Content-Type": "text/plain;charset=UTF-8",
              "Authorization": "Bearer " + token,
            },
            body: JSON.stringify(requestBody),
          });

          const text = await response.text();
          return {
            status: response.status,
            body: text,
            draftId,
            threadId,
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("Result:", JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

main();
