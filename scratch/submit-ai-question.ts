/**
 * Submit a question to Ask AI and capture the event IDs
 */
import WebSocket from "ws";

const CDP_URL = "http://localhost:9333";

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
  const capturedNetworkRequests: any[] = [];

  // Listen for network events
  ws.on("message", (data: any) => {
    const msg = JSON.parse(data.toString());

    if (msg.method === "Network.requestWillBeSent") {
      const { request, requestId } = msg.params;
      const { url, method, postData } = request;

      if (url.includes("ai.") ||
          url.includes("askAI") ||
          url.includes("agent") ||
          url.includes("question") ||
          (postData && (postData.includes("question_event") || postData.includes("session_id") || postData.includes("askAI")))) {

        console.log(`\n[NETWORK REQUEST] ${method} ${url}`);
        if (postData) {
          try {
            const body = JSON.parse(postData);
            console.log("Body:", JSON.stringify(body, null, 2));
            capturedNetworkRequests.push({ url, body, timestamp: new Date().toISOString() });
          } catch {
            console.log("Raw postData:", postData.slice(0, 1000));
          }
        }
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

    // First, reinstall the fetch interceptor to ensure it's working
    console.log("\nInstalling fetch interceptor...");
    await send("Runtime.evaluate", {
      expression: `
        (function() {
          if (window.__fetchInterceptorInstalled) return 'already installed';

          const originalFetch = window.fetch;
          window.__capturedAIRequests = window.__capturedAIRequests || [];

          window.fetch = async function(...args) {
            const [url, options] = args;
            const urlStr = typeof url === 'string' ? url : url.url || '';

            if (urlStr.includes('ai.') || urlStr.includes('askAI') || urlStr.includes('agent') || urlStr.includes('question')) {
              const body = options?.body;
              if (body) {
                try {
                  const parsed = JSON.parse(body);
                  window.__capturedAIRequests.push({
                    url: urlStr,
                    body: parsed,
                    timestamp: Date.now()
                  });
                  console.log('[AI Request Captured]', urlStr, parsed);
                } catch (e) {}
              }
            }

            return originalFetch.apply(this, args);
          };

          window.__fetchInterceptorInstalled = true;
          return 'installed';
        })()
      `,
      returnByValue: true
    });

    // Find the AI input textarea
    console.log("\nLooking for AI input...");

    const findInputExpr = `
      (function() {
        // Look for input/textarea in the AI sidebar
        const inputs = document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]');
        const results = [];

        for (const input of inputs) {
          const parent = input.closest('.AISidebar, [class*="AI"], [class*="ai"]');
          if (parent || input.className?.toLowerCase().includes('ai')) {
            results.push({
              tag: input.tagName,
              className: input.className?.slice(0, 100),
              placeholder: input.getAttribute('placeholder'),
              value: input.value?.slice(0, 50) || input.textContent?.slice(0, 50)
            });
          }
        }

        // Also look for any visible textarea/input
        for (const input of inputs) {
          const style = window.getComputedStyle(input);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            const rect = input.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              results.push({
                tag: input.tagName,
                className: input.className?.slice(0, 100),
                placeholder: input.getAttribute('placeholder'),
                visible: true,
                rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
              });
            }
          }
        }

        return JSON.stringify(results, null, 2);
      })()
    `;

    const inputResult = await send("Runtime.evaluate", {
      expression: findInputExpr,
      returnByValue: true
    });

    console.log("Found inputs:", inputResult?.result?.value);

    // Focus the AI input and type a question
    console.log("\nFocusing AI input and typing question...");

    const typeExpr = `
      (function() {
        // Find the AI input
        const aiInput = document.querySelector('.AISidebar textarea, .AISidebar input, [class*="AI"] textarea');
        if (aiInput) {
          aiInput.focus();
          aiInput.value = 'What is this email about?';
          aiInput.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true, value: aiInput.value };
        }

        // Try to find any visible textarea
        const textareas = document.querySelectorAll('textarea');
        for (const ta of textareas) {
          const style = window.getComputedStyle(ta);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            const rect = ta.getBoundingClientRect();
            if (rect.width > 100) {  // Probably a real input
              ta.focus();
              ta.value = 'What is this email about?';
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              return { success: true, value: ta.value, className: ta.className };
            }
          }
        }

        return { success: false };
      })()
    `;

    const typeResult = await send("Runtime.evaluate", {
      expression: typeExpr,
      returnByValue: true
    });

    console.log("Type result:", typeResult?.result?.value);

    // Now click the send button
    console.log("\nClicking send button...");

    const clickSendExpr = `
      (function() {
        // Find the send button
        const sendButton = document.querySelector('.AI-send-button, [class*="send-button"], button[aria-label*="Send"]');
        if (sendButton) {
          sendButton.click();
          return { success: true, className: sendButton.className };
        }

        // Try to find any button near the input
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.className?.includes('AI') || btn.className?.includes('send')) {
            btn.click();
            return { success: true, className: btn.className };
          }
        }

        return { success: false };
      })()
    `;

    const clickResult = await send("Runtime.evaluate", {
      expression: clickSendExpr,
      returnByValue: true
    });

    console.log("Click send result:", clickResult?.result?.value);

    // Wait for the request to be made
    console.log("\nWaiting for AI request...");
    await new Promise(r => setTimeout(r, 5000));

    // Check captured requests
    const capturedExpr = `
      (function() {
        return {
          capturedAIRequests: window.__capturedAIRequests || [],
          count: (window.__capturedAIRequests || []).length
        };
      })()
    `;

    const capturedResult = await send("Runtime.evaluate", {
      expression: capturedExpr,
      returnByValue: true
    });

    console.log("\n=== CAPTURED AI REQUESTS ===");
    console.log(JSON.stringify(capturedResult?.result?.value, null, 2));

    console.log("\n=== NETWORK CAPTURED REQUESTS ===");
    console.log(JSON.stringify(capturedNetworkRequests, null, 2));

    // Also try to get the event ID from the response in the UI
    console.log("\n=== Checking for event IDs in DOM ===");

    const domIdExpr = `
      (function() {
        // Look for any data attributes with IDs
        const elements = document.querySelectorAll('[data-event-id], [data-session-id], [data-question-id]');
        const ids = [];
        for (const el of elements) {
          ids.push({
            eventId: el.getAttribute('data-event-id'),
            sessionId: el.getAttribute('data-session-id'),
            questionId: el.getAttribute('data-question-id')
          });
        }

        // Also check the AI response area for any IDs
        const aiResponse = document.querySelector('.AISidebar-messages, [class*="AI-response"], [class*="ai-response"]');
        if (aiResponse) {
          const text = aiResponse.textContent?.slice(0, 500);
          return { ids, responseText: text };
        }

        return { ids };
      })()
    `;

    const domIdResult = await send("Runtime.evaluate", {
      expression: domIdExpr,
      returnByValue: true
    });

    console.log("DOM IDs:", JSON.stringify(domIdResult?.result?.value, null, 2));

    ws.close();
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    process.exit(1);
  });
}

main().catch(console.error);
