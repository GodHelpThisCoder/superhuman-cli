/**
 * Capture multiple AI requests to analyze the event ID pattern
 */
import WebSocket from "ws";

const CDP_URL = "http://localhost:9333";

const questions = [
  "Summarize this email",
  "Who sent this email?",
  "What action is needed?"
];

async function main() {
  const response = await fetch(CDP_URL + "/json");
  const targets = await response.json() as any[];

  const superhuman = targets.find(t =>
    t.url.includes("mail.superhuman.com") &&
    t.url.indexOf("background") === -1 &&
    t.url.indexOf("serviceworker") === -1 &&
    t.webSocketDebuggerUrl
  );

  if (!superhuman) {
    console.log("Superhuman not found");
    process.exit(1);
  }

  console.log("Connected to:", superhuman.title);

  const ws = new WebSocket(superhuman.webSocketDebuggerUrl);
  let msgId = 0;
  const capturedIds: any[] = [];

  // Listen for network events
  ws.on("message", (data: any) => {
    const msg = JSON.parse(data.toString());

    if (msg.method === "Network.requestWillBeSent") {
      const { request } = msg.params;
      const { url, postData } = request;

      if (url.includes("ai.askAIProxy") && postData) {
        try {
          const body = JSON.parse(postData);
          console.log(`\n[CAPTURED] question_event_id: ${body.question_event_id}`);
          console.log(`           session_id: ${body.session_id}`);
          console.log(`           query: ${body.query}`);
          capturedIds.push({
            question_event_id: body.question_event_id,
            session_id: body.session_id,
            query: body.query,
            timestamp: new Date().toISOString()
          });
        } catch {}
      }
    }
  });

  const send = (method: string, params: any = {}): Promise<any> => {
    return new Promise((resolve) => {
      const id = ++msgId;
      const timeout = setTimeout(() => {
        ws.off("message", handler);
        resolve(null);
      }, 10000);

      const handler = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.off("message", handler);
          resolve(msg.result);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  ws.on("open", async () => {
    console.log("\nConnected to CDP\n");

    // Enable network monitoring
    await send("Network.enable");
    console.log("Network monitoring enabled");

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      console.log(`\n--- Question ${i + 1}: "${question}" ---`);

      // Focus and clear the input
      await send("Runtime.evaluate", {
        expression: `
          (function() {
            const inputContainer = document.querySelector('.AIAgent-input-container');
            if (inputContainer) inputContainer.click();
          })()
        `
      });
      await new Promise(r => setTimeout(r, 300));

      // Clear any existing text and insert new question
      await send("Input.insertText", { text: question });
      await new Promise(r => setTimeout(r, 300));

      // Press Enter to submit
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        text: "\r",
        nativeVirtualKeyCode: 13,
        windowsVirtualKeyCode: 13
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter"
      });

      // Wait for response
      console.log("Waiting for response...");
      await new Promise(r => setTimeout(r, 8000));
    }

    // Analysis
    console.log("\n\n=== EVENT ID ANALYSIS ===\n");

    const uniqueEventIds = [...new Set(capturedIds.map(c => c.question_event_id))];
    const uniqueSessionIds = [...new Set(capturedIds.map(c => c.session_id))];

    console.log(`Total requests captured: ${capturedIds.length}`);
    console.log(`Unique question_event_ids: ${uniqueEventIds.length}`);
    console.log(`Unique session_ids: ${uniqueSessionIds.length}`);

    console.log("\n--- question_event_id values ---");
    for (const id of uniqueEventIds) {
      const suffix = id.replace("event_", "");
      console.log(`  ${id}`);
      console.log(`    - Suffix: ${suffix} (${suffix.length} chars)`);
      console.log(`    - Charset: ${analyzeCharset(suffix)}`);
    }

    console.log("\n--- session_id values ---");
    for (const id of uniqueSessionIds) {
      console.log(`  ${id}`);
    }

    // Check if event IDs share a prefix pattern
    console.log("\n--- Prefix analysis ---");
    if (uniqueEventIds.length > 1) {
      const suffixes = uniqueEventIds.map(id => id.replace("event_", ""));
      const commonPrefix = findCommonPrefix(suffixes);
      console.log(`Common prefix after 'event_': "${commonPrefix}" (${commonPrefix.length} chars)`);
    }

    ws.close();
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    process.exit(1);
  });
}

function analyzeCharset(str: string): string {
  const hasLower = /[a-z]/.test(str);
  const hasUpper = /[A-Z]/.test(str);
  const hasDigit = /[0-9]/.test(str);
  const hasSpecial = /[^a-zA-Z0-9]/.test(str);

  const parts = [];
  if (hasLower) parts.push("lowercase");
  if (hasUpper) parts.push("uppercase");
  if (hasDigit) parts.push("digits");
  if (hasSpecial) parts.push("special");

  return parts.join(" + ");
}

function findCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  if (strings.length === 1) return strings[0];

  let prefix = "";
  for (let i = 0; i < strings[0].length; i++) {
    const char = strings[0][i];
    if (strings.every(s => s[i] === char)) {
      prefix += char;
    } else {
      break;
    }
  }
  return prefix;
}

main().catch(console.error);
