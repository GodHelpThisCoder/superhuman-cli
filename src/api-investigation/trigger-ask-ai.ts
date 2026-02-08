/**
 * Trigger Ask AI programmatically and capture the event ID
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime, Network } = conn;

  console.log("Enabling network monitoring...");
  await Network.enable();

  // Capture network requests
  const capturedRequests: any[] = [];

  Network.requestWillBeSent((params) => {
    const url = params.request.url;
    if (url.includes("ai.") || url.includes("askAI")) {
      try {
        const body = params.request.postData ? JSON.parse(params.request.postData) : null;
        capturedRequests.push({
          url,
          question_event_id: body?.question_event_id,
          session_id: body?.session_id,
        });
        console.log("Captured request:", {
          url,
          question_event_id: body?.question_event_id,
        });
      } catch {}
    }
  });

  console.log("\nLooking for Ask AI trigger methods...");

  // Try to find and call the Ask AI opener
  const triggerResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        const results = {};

        // Look for AI-related services
        if (di?._services) {
          const aiServices = Object.keys(di._services).filter(k =>
            k.toLowerCase().includes('ai') ||
            k.toLowerCase().includes('agent') ||
            k.toLowerCase().includes('ask')
          );
          results.aiServices = aiServices;

          // Try to get each service and inspect
          for (const svcName of aiServices) {
            try {
              const svc = di.get(svcName);
              if (svc) {
                results[svcName + '_keys'] = Object.keys(svc).filter(k => typeof svc[k] === 'function').slice(0, 15);
              }
            } catch {}
          }
        }

        // Look for command palette or shortcuts
        try {
          const shortcuts = di?.get?.('shortcuts');
          if (shortcuts) {
            results.shortcutsKeys = Object.keys(shortcuts).slice(0, 20);
          }
        } catch {}

        // Try to find the sidebar AI agent controller
        try {
          const sidebarAgent = di?.get?.('sidebarAIAgent');
          if (sidebarAgent) {
            results.sidebarAgentKeys = Object.keys(sidebarAgent);
            // Try to open it
            if (typeof sidebarAgent.open === 'function') {
              await sidebarAgent.open();
              results.sidebarAgentOpened = true;
            }
          }
        } catch (e) {
          results.sidebarAgentError = e.message;
        }

        return results;
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("Trigger result:", JSON.stringify(triggerResult.result.value, null, 2));

  // Wait for any network activity
  await new Promise(r => setTimeout(r, 2000));

  console.log("\nCaptured requests:", capturedRequests);

  // If we found the sidebar agent, try to send a message
  if (triggerResult.result.value.sidebarAgentOpened) {
    console.log("\nTrying to send a message via sidebar agent...");

    const sendResult = await Runtime.evaluate({
      expression: `
        (async () => {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          const sidebarAgent = di?.get?.('sidebarAIAgent');

          if (!sidebarAgent) return { error: 'No sidebar agent' };

          // Look for send/ask methods
          const methods = Object.keys(sidebarAgent).filter(k => typeof sidebarAgent[k] === 'function');

          // Try common method names
          for (const method of ['sendMessage', 'send', 'ask', 'query', 'submit']) {
            if (typeof sidebarAgent[method] === 'function') {
              try {
                await sidebarAgent[method]('hello');
                return { sentVia: method };
              } catch (e) {
                // Continue
              }
            }
          }

          return { methods, error: 'Could not find send method' };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    console.log("Send result:", JSON.stringify(sendResult.result.value, null, 2));
  }

  // Wait more for network
  await new Promise(r => setTimeout(r, 3000));

  console.log("\nFinal captured requests:", capturedRequests);

  await disconnect(conn);
}

main().catch(console.error);
