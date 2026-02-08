/**
 * Open Ask AI via CDP and capture the event ID generated
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime, Input } = conn;

  console.log("Setting up interceptor...");

  // Set up intercept to capture AI calls
  await Runtime.evaluate({
    expression: `
      (function() {
        const originalFetch = window.fetch;
        window._capturedAICalls = [];

        window.fetch = async function(...args) {
          const [url, options] = args;

          if (typeof url === 'string' && (url.includes('ai.') || url.includes('agent'))) {
            try {
              const body = options?.body;
              if (body) {
                const parsed = JSON.parse(body);
                window._capturedAICalls.push({
                  url: url,
                  timestamp: Date.now(),
                  session_id: parsed.session_id,
                  question_event_id: parsed.question_event_id,
                  agent_session_id: parsed.agent_session_id,
                });
              }
            } catch (e) {}
          }

          return originalFetch.apply(this, args);
        };
      })()
    `,
  });

  console.log("Pressing '?' to open Ask AI...");

  // Press '?' key to open Ask AI
  await Input.dispatchKeyEvent({
    type: "keyDown",
    key: "?",
    text: "?",
  });
  await Input.dispatchKeyEvent({
    type: "keyUp",
    key: "?",
  });

  // Wait for the panel to open
  await new Promise(r => setTimeout(r, 1000));

  // Check for any agent/session IDs that were created
  const sessionResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;

        // Look for any AI session state
        const results = {};

        // Check for agent sessions
        try {
          const di = ga?.di;
          const agentService = di?.get?.('aiAgent') || di?.get?.('askAI') || di?.get?.('agent');
          if (agentService) {
            results.agentService = Object.keys(agentService);
            if (agentService.sessionId) results.sessionId = agentService.sessionId;
            if (agentService.currentSession) results.currentSession = agentService.currentSession;
          }
        } catch {}

        // Look in window for any new agent state
        for (const key of Object.keys(window)) {
          if (key.toLowerCase().includes('agent') || key.toLowerCase().includes('ai')) {
            const val = window[key];
            if (typeof val === 'object' && val !== null) {
              results['window.' + key] = Object.keys(val).slice(0, 10);
            }
          }
        }

        // Check captured calls
        results.capturedCalls = window._capturedAICalls;

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("Session state:", JSON.stringify(sessionResult.result.value, null, 2));

  // Wait a bit more for any AI initialization
  await new Promise(r => setTimeout(r, 2000));

  // Now type a question
  console.log("\nTyping a question...");
  const question = "hello";
  for (const char of question) {
    await Input.dispatchKeyEvent({
      type: "keyDown",
      key: char,
      text: char,
    });
    await Input.dispatchKeyEvent({
      type: "keyUp",
      key: char,
    });
    await new Promise(r => setTimeout(r, 50));
  }

  // Press Enter to submit
  console.log("Pressing Enter to submit...");
  await Input.dispatchKeyEvent({
    type: "keyDown",
    key: "Enter",
    code: "Enter",
  });
  await Input.dispatchKeyEvent({
    type: "keyUp",
    key: "Enter",
    code: "Enter",
  });

  // Wait for the API call
  await new Promise(r => setTimeout(r, 3000));

  // Check captured calls
  const capturedResult = await Runtime.evaluate({
    expression: `window._capturedAICalls`,
    returnByValue: true,
  });

  console.log("\nCaptured AI calls:");
  console.log(JSON.stringify(capturedResult.result.value, null, 2));

  // Close the panel with Escape
  await Input.dispatchKeyEvent({
    type: "keyDown",
    key: "Escape",
  });
  await Input.dispatchKeyEvent({
    type: "keyUp",
    key: "Escape",
  });

  await disconnect(conn);
}

main().catch(console.error);
