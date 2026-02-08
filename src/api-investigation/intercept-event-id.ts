/**
 * Monitor for event ID generation in Superhuman
 *
 * We'll intercept fetch calls to see what IDs are being generated
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  console.log("Setting up fetch interceptor...");

  // Intercept fetch to capture AI API calls
  await conn.Runtime.evaluate({
    expression: `
      (function() {
        const originalFetch = window.fetch;
        window._capturedAICalls = [];

        window.fetch = async function(...args) {
          const [url, options] = args;

          // Check if this is an AI API call
          if (typeof url === 'string' && url.includes('ai.askAIProxy')) {
            try {
              const body = options?.body;
              if (body) {
                const parsed = JSON.parse(body);
                window._capturedAICalls.push({
                  timestamp: Date.now(),
                  session_id: parsed.session_id,
                  question_event_id: parsed.question_event_id,
                  query: parsed.query?.substring(0, 50),
                });
                console.log('[INTERCEPTED AI CALL]', parsed.question_event_id);
              }
            } catch (e) {
              console.log('[INTERCEPT ERROR]', e.message);
            }
          }

          return originalFetch.apply(this, args);
        };

        console.log('Fetch interceptor installed');
      })()
    `,
  });

  console.log("Interceptor installed. Now use 'Ask AI' in Superhuman...");
  console.log("Press Ctrl+C to stop and show captured calls\n");

  // Poll for captured calls
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));

    const result = await conn.Runtime.evaluate({
      expression: `window._capturedAICalls`,
      returnByValue: true,
    });

    const calls = result.result.value;
    if (calls && calls.length > 0) {
      console.log("Captured AI calls:", JSON.stringify(calls, null, 2));
      break;
    }
    process.stdout.write(".");
  }

  await disconnect(conn);
}

main().catch(console.error);
