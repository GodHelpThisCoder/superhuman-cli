/**
 * Test aiComposeAgentic endpoint with various action_type values.
 *
 * Tries different action_type and draft_action combinations to see which are accepted.
 */

import { connectToSuperhuman, disconnect } from "../src/superhuman-api";
import { listAccounts, getCurrentAccount } from "../src/accounts";
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

  // Get current account and token
  const email = await getCurrentAccount(conn);
  if (!email) {
    console.error("No current account found.");
    process.exit(1);
  }
  console.log(`Current account: ${email}`);

  const tokenInfo = await extractSuperhumanToken(conn, email);
  const token = tokenInfo.token;
  console.log(`Token extracted (expires: ${tokenInfo.expires})\n`);

  const sessionId = crypto.randomUUID();
  const localDateTime = new Date().toISOString();
  const questionEventId = `event_${crypto.randomUUID().replace(/-/g, '').substring(0, 18)}`;

  // User info (minimal)
  const user = {
    name: "Test User",
    email: email,
  };

  // Test configurations
  const tests = [
    // action_type variants with draft_action "compose"
    { name: "action_type=compose, draft_action=compose", actionType: "compose", draftAction: "compose" },
    { name: "action_type=reply, draft_action=reply", actionType: "reply", draftAction: "reply" },
    { name: "action_type=edit, draft_action=compose", actionType: "edit", draftAction: "compose" },
    { name: "action_type=rewrite, draft_action=compose", actionType: "rewrite", draftAction: "compose" },
    { name: "action_type=shorten, draft_action=compose", actionType: "shorten", draftAction: "compose" },
    { name: "action_type=lengthen, draft_action=compose", actionType: "lengthen", draftAction: "compose" },
    { name: "action_type=fix_grammar, draft_action=compose", actionType: "fix_grammar", draftAction: "compose" },
    { name: "action_type=write, draft_action=compose", actionType: "write", draftAction: "compose" },
    { name: "action_type=draft, draft_action=compose", actionType: "draft", draftAction: "compose" },
    { name: "action_type=generate, draft_action=compose", actionType: "generate", draftAction: "compose" },
    { name: "action_type=ask, draft_action=compose", actionType: "ask", draftAction: "compose" },
    { name: "action_type=chat, draft_action=compose", actionType: "chat", draftAction: "compose" },
    { name: "action_type=free_form, draft_action=compose", actionType: "free_form", draftAction: "compose" },

    // No action_type, just draft_action
    { name: "no action_type, draft_action=compose", actionType: undefined, draftAction: "compose" },
    { name: "no action_type, draft_action=reply", actionType: undefined, draftAction: "reply" },
    { name: "no action_type, draft_action=forward", actionType: undefined, draftAction: "forward" },

    // Interactive mode
    { name: "interactive=true, action_type=compose", actionType: "compose", draftAction: "compose", interactive: true },
    { name: "interactive=true, no action_type", actionType: undefined, draftAction: "compose", interactive: true },
  ];

  console.log("=== Testing aiComposeAgentic with Various action_type Values ===\n");

  for (const test of tests) {
    const payload: any = {
      instructions: "Write a short email about scheduling a meeting next Tuesday at 2pm",
      session_id: sessionId,
      local_datetime: localDateTime,
      question_event_id: questionEventId,
      user,
      draft_action: test.draftAction,
      content: "",
      content_type: "text/html",
      thread_id: "",
      last_message_id: "",
      thread_content: "",
      subject: "",
      to: [],
      cc: [],
      bcc: [],
      interactive: test.interactive || false,
      selected_text: "",
      retry_count: 0,
      draft_id: "",
    };

    if (test.actionType !== undefined) {
      payload.action_type = test.actionType;
    }

    try {
      const response = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.composeAgentic`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const status = response.status;
      let responsePreview = "";

      if (status === 200) {
        // Read first chunk of stream
        const text = await response.text();
        const lines = text.split("\n").filter(l => l.startsWith("data: ")).slice(0, 3);
        responsePreview = lines.join("\n").substring(0, 500);
      } else {
        responsePreview = await response.text().catch(() => "");
        responsePreview = responsePreview.substring(0, 500);
      }

      const emoji = status === 200 ? "OK" : "FAIL";
      console.log(`[${emoji}] ${test.name} => ${status}`);
      if (responsePreview) {
        console.log(`    Preview: ${responsePreview.substring(0, 300)}`);
      }
    } catch (e) {
      console.log(`[ERR] ${test.name} => ${(e as Error).message}`);
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  // Also test ai.composeEdit with various action_type values
  console.log("\n\n=== Testing ai.composeEdit with Various action_type Values ===\n");

  const editTests = [
    { name: "action_type=compose", actionType: "compose" },
    { name: "action_type=rewrite", actionType: "rewrite" },
    { name: "action_type=shorten", actionType: "shorten" },
    { name: "action_type=lengthen", actionType: "lengthen" },
    { name: "action_type=fix_grammar", actionType: "fix_grammar" },
    { name: "action_type=edit", actionType: "edit" },
    { name: "action_type=write", actionType: "write" },
    { name: "action_type=improve", actionType: "improve" },
    { name: "action_type=tone_change", actionType: "tone_change" },
    { name: "action_type=autocomplete", actionType: "autocomplete" },
  ];

  for (const test of editTests) {
    const payload: any = {
      action_type: test.actionType,
      content: "<p>Please let me know when you are available for a meeting.</p>",
      content_type: "text/html",
      thread_id: "",
      last_message_id: "",
      to: [],
      cc: [],
      bcc: [],
      session_id: sessionId,
      local_datetime: localDateTime,
      question_event_id: questionEventId,
      instructions: "Make this more professional and formal",
      selected_text: "",
      retry_count: 0,
      draft_id: "",
    };

    try {
      const response = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.composeEdit`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const status = response.status;
      let responsePreview = "";

      if (status === 200) {
        const text = await response.text();
        const lines = text.split("\n").filter(l => l.startsWith("data: ")).slice(0, 3);
        responsePreview = lines.join("\n").substring(0, 500);
      } else {
        responsePreview = await response.text().catch(() => "");
        responsePreview = responsePreview.substring(0, 500);
      }

      const emoji = status === 200 ? "OK" : "FAIL";
      console.log(`[${emoji}] ${test.name} => ${status}`);
      if (responsePreview) {
        console.log(`    Preview: ${responsePreview.substring(0, 300)}`);
      }
    } catch (e) {
      console.log(`[ERR] ${test.name} => ${(e as Error).message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  await disconnect(conn);
  console.log("\nDone.");
}

main().catch(console.error);
