import { connectToSuperhuman, disconnect, openCompose, closeCompose } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  const capturedRequests: any[] = [];

  // Enable network monitoring
  await conn.Network.enable({});

  // Capture all requests
  conn.Network.requestWillBeSent((params) => {
    const url = params.request.url;
    // Filter for Superhuman backend calls
    if (url.includes("superhuman") || url.includes("snippet") || url.includes("phrase") || url.includes("template")) {
      capturedRequests.push({
        url,
        method: params.request.method,
        postData: params.request.postData?.slice(0, 500),
        type: params.type
      });
    }
  });

  // Also capture responses
  conn.Network.responseReceived((params) => {
    const url = params.response.url;
    if (url.includes("snippet") || url.includes("phrase") || url.includes("template")) {
      console.log("Response:", url, params.response.status);
    }
  });

  console.log("Network monitoring enabled. Opening compose and triggering snippets...\n");

  // Open compose
  const draftKey = await openCompose(conn);
  console.log("Opened compose:", draftKey);
  await new Promise(r => setTimeout(r, 500));

  // Trigger "g ;" to open snippets (or just ";")
  console.log("Pressing g ; to open snippets...");
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: "g", code: "KeyG", text: "g" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: "g", code: "KeyG" });
  await new Promise(r => setTimeout(r, 100));
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: ";", code: "Semicolon", text: ";" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: ";", code: "Semicolon" });

  // Wait for network activity
  await new Promise(r => setTimeout(r, 2000));

  // Also try just ";" in the body
  console.log("Pressing ; in body...");
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: ";", code: "Semicolon", text: ";" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: ";", code: "Semicolon" });

  await new Promise(r => setTimeout(r, 2000));

  // Press Escape to close any popup
  await conn.Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await conn.Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });

  console.log("\n=== Captured Requests ===");
  console.log(JSON.stringify(capturedRequests, null, 2));

  // Close compose
  if (draftKey) {
    await closeCompose(conn, draftKey);
  }

  await disconnect(conn);
}

main().catch(console.error);
