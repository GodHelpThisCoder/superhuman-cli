/**
 * Monitor console logs from Superhuman for AI-related activity
 */

import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  console.log("=== Console Log Monitor ===\n");

  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  const { client, Runtime } = conn;

  // Enable Runtime for console messages
  await Runtime.enable();

  // Listen for console messages
  Runtime.consoleAPICalled((params: any) => {
    const args = params.args.map((arg: any) => {
      if (arg.type === "string") return arg.value;
      if (arg.type === "object") {
        if (arg.preview) {
          return JSON.stringify(arg.preview.properties?.reduce((acc: any, p: any) => {
            acc[p.name] = p.value;
            return acc;
          }, {}));
        }
        return arg.description || arg.className;
      }
      return arg.value || arg.description || arg.type;
    }).join(" ");

    const logLine = `[${params.type}] ${args}`;

    // Show logs that might be AI-related
    if (args.toLowerCase().includes("ai") ||
        args.toLowerCase().includes("ask") ||
        args.toLowerCase().includes("event") ||
        args.toLowerCase().includes("session") ||
        args.toLowerCase().includes("question") ||
        args.includes("INTERCEPTED")) {
      console.log(logLine);
    }
  });

  console.log("Monitoring console logs for AI activity...");
  console.log("Use 'Ask AI' in Superhuman (J key)\n");
  console.log("-".repeat(60));

  // Also try to trigger by pressing J
  console.log("\nAttempting to simulate J key press to open Ask AI...\n");

  await conn.Input.dispatchKeyEvent({
    type: "keyDown",
    key: "j",
    code: "KeyJ",
    windowsVirtualKeyCode: 74,
  });

  await new Promise(r => setTimeout(r, 100));

  await conn.Input.dispatchKeyEvent({
    type: "keyUp",
    key: "j",
    code: "KeyJ",
    windowsVirtualKeyCode: 74,
  });

  console.log("Sent J key. Waiting for activity...\n");

  // Keep running for 30 seconds
  await new Promise(r => setTimeout(r, 30000));

  // Try to get any captured data
  const result = await Runtime.evaluate({
    expression: `JSON.stringify(window.__capturedAIRequests || [], null, 2)`,
    returnByValue: true
  });

  console.log("\nCaptured requests from window:", result.result.value);

  await disconnect(conn);
}

main().catch(console.error);
