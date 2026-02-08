/**
 * Test ai.compose without thread context.
 *
 * Calls ai.compose with draft_action "compose" and empty thread fields
 * to see if it works for standalone composition.
 */

import { connectToSuperhuman, disconnect } from "../src/superhuman-api";
import { getCurrentAccount } from "../src/accounts";
import { extractSuperhumanToken } from "../src/token-api";

const CDP_PORT = 9333;
const SUPERHUMAN_BACKEND_BASE = "https://mail.superhuman.com/~backend";

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(CDP_PORT);

  if (!conn) {
    console.error("Failed to connect.");
    process.exit(1);
  }

  const email = await getCurrentAccount(conn);
  if (!email) {
    console.error("No current account found.");
    process.exit(1);
  }
  console.log(`Current account: ${email}`);

  const tokenInfo = await extractSuperhumanToken(conn, email);
  const token = tokenInfo.token;
  console.log(`Token extracted\n`);

  // Test 1: ai.compose with draft_action "compose" and empty thread
  console.log("=== Test 1: ai.compose with draft_action='compose', empty thread ===\n");

  const payload1 = {
    instructions: "Write a short email about scheduling a meeting next Tuesday at 2pm with the engineering team",
    draft_content: "",
    draft_content_type: "text/html",
    draft_action: "compose",
    thread_content: "",
    subject: "",
    to: [],
    cc: [],
    bcc: [],
    thread_id: "",
    last_message_id: "",
  };

  try {
    const response1 = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.compose`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload1),
    });

    console.log(`Status: ${response1.status} ${response1.statusText}`);

    if (response1.ok) {
      const text = await response1.text();
      // Parse SSE stream
      let fullContent = "";
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.substring(6).trim();
          if (jsonStr === "[DONE]" || jsonStr === "END" || jsonStr === "") continue;
          try {
            const data = JSON.parse(jsonStr);
            const delta = data?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              fullContent += delta;
            }
          } catch {}
        }
      }
      console.log(`\nGenerated content:\n${fullContent}\n`);
    } else {
      const errorText = await response1.text();
      console.log(`Error: ${errorText}\n`);
    }
  } catch (e) {
    console.log(`Exception: ${(e as Error).message}\n`);
  }

  // Test 2: ai.compose with draft_action "compose" and subject provided
  console.log("=== Test 2: ai.compose with draft_action='compose', with subject ===\n");

  const payload2 = {
    instructions: "Write a professional email",
    draft_content: "",
    draft_content_type: "text/html",
    draft_action: "compose",
    thread_content: "",
    subject: "Meeting Scheduling Request",
    to: [],
    cc: [],
    bcc: [],
    thread_id: "",
    last_message_id: "",
  };

  try {
    const response2 = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.compose`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload2),
    });

    console.log(`Status: ${response2.status} ${response2.statusText}`);

    if (response2.ok) {
      const text = await response2.text();
      let fullContent = "";
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.substring(6).trim();
          if (jsonStr === "[DONE]" || jsonStr === "END" || jsonStr === "") continue;
          try {
            const data = JSON.parse(jsonStr);
            const delta = data?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") fullContent += delta;
          } catch {}
        }
      }
      console.log(`\nGenerated content:\n${fullContent}\n`);
    } else {
      const errorText = await response2.text();
      console.log(`Error: ${errorText}\n`);
    }
  } catch (e) {
    console.log(`Exception: ${(e as Error).message}\n`);
  }

  // Test 3: ai.compose with draft_action "reply" but NO thread (expect failure)
  console.log("=== Test 3: ai.compose with draft_action='reply', no thread (should fail?) ===\n");

  const payload3 = {
    instructions: "Thank them for their time and propose next steps",
    draft_content: "",
    draft_content_type: "text/html",
    draft_action: "reply",
    thread_content: "",
    subject: "",
    to: [],
    cc: [],
    bcc: [],
    thread_id: "",
    last_message_id: "",
  };

  try {
    const response3 = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.compose`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload3),
    });

    console.log(`Status: ${response3.status} ${response3.statusText}`);

    if (response3.ok) {
      const text = await response3.text();
      let fullContent = "";
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.substring(6).trim();
          if (jsonStr === "[DONE]" || jsonStr === "END" || jsonStr === "") continue;
          try {
            const data = JSON.parse(jsonStr);
            const delta = data?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") fullContent += delta;
          } catch {}
        }
      }
      console.log(`\nGenerated content:\n${fullContent}\n`);
    } else {
      const errorText = await response3.text();
      console.log(`Error: ${errorText}\n`);
    }
  } catch (e) {
    console.log(`Exception: ${(e as Error).message}\n`);
  }

  // Test 4: ai.compose with draft_action "compose" and existing draft content (edit scenario)
  console.log("=== Test 4: ai.compose with draft_action='compose' and existing draft content ===\n");

  const payload4 = {
    instructions: "Make this more formal and professional",
    draft_content: "<p>Hey, wanna meet up Tuesday to talk about the project?</p>",
    draft_content_type: "text/html",
    draft_action: "compose",
    thread_content: "",
    subject: "Project Discussion",
    to: [],
    cc: [],
    bcc: [],
    thread_id: "",
    last_message_id: "",
  };

  try {
    const response4 = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.compose`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload4),
    });

    console.log(`Status: ${response4.status} ${response4.statusText}`);

    if (response4.ok) {
      const text = await response4.text();
      let fullContent = "";
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.substring(6).trim();
          if (jsonStr === "[DONE]" || jsonStr === "END" || jsonStr === "") continue;
          try {
            const data = JSON.parse(jsonStr);
            const delta = data?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") fullContent += delta;
          } catch {}
        }
      }
      console.log(`\nGenerated content:\n${fullContent}\n`);
    } else {
      const errorText = await response4.text();
      console.log(`Error: ${errorText}\n`);
    }
  } catch (e) {
    console.log(`Exception: ${(e as Error).message}\n`);
  }

  // Test 5: ai.compose with "forward" action
  console.log("=== Test 5: ai.compose with draft_action='forward', no thread ===\n");

  const payload5 = {
    instructions: "Write a forwarding note asking for their input on this thread",
    draft_content: "",
    draft_content_type: "text/html",
    draft_action: "forward",
    thread_content: "",
    subject: "",
    to: [],
    cc: [],
    bcc: [],
    thread_id: "",
    last_message_id: "",
  };

  try {
    const response5 = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.compose`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload5),
    });

    console.log(`Status: ${response5.status} ${response5.statusText}`);

    if (response5.ok) {
      const text = await response5.text();
      let fullContent = "";
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.substring(6).trim();
          if (jsonStr === "[DONE]" || jsonStr === "END" || jsonStr === "") continue;
          try {
            const data = JSON.parse(jsonStr);
            const delta = data?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") fullContent += delta;
          } catch {}
        }
      }
      console.log(`\nGenerated content:\n${fullContent}\n`);
    } else {
      const errorText = await response5.text();
      console.log(`Error: ${errorText}\n`);
    }
  } catch (e) {
    console.log(`Exception: ${(e as Error).message}\n`);
  }

  await disconnect(conn);
  console.log("Done.");
}

main().catch(console.error);
