/**
 * Inspect the AI sidebar DOM structure
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

    // Get the AI sidebar HTML structure
    console.log("=== AI Sidebar DOM ===\n");

    const sidebarExpr = `
      (function() {
        const sidebar = document.querySelector('.AISidebar, [class*="AISidebar"]');
        if (sidebar) {
          // Get the HTML structure
          return sidebar.outerHTML;
        }

        // Try other selectors
        const aiElements = document.querySelectorAll('[class*="AI"]');
        let html = '';
        for (const el of aiElements) {
          if (el.className.includes('Sidebar') || el.className.includes('sidebar')) {
            html += el.outerHTML + '\\n\\n';
          }
        }

        return html || 'AI Sidebar not found';
      })()
    `;

    const sidebarResult = await send("Runtime.evaluate", {
      expression: sidebarExpr,
      returnByValue: true
    });

    console.log(sidebarResult?.result?.value?.slice(0, 5000));

    // Also list all inputs and textareas on the page
    console.log("\n\n=== All textareas/inputs on page ===\n");

    const inputsExpr = `
      (function() {
        const inputs = [];

        // Get all textareas
        document.querySelectorAll('textarea').forEach((el, i) => {
          inputs.push({
            type: 'textarea',
            index: i,
            className: el.className,
            placeholder: el.placeholder,
            visible: window.getComputedStyle(el).display !== 'none',
            rect: el.getBoundingClientRect()
          });
        });

        // Get all text inputs
        document.querySelectorAll('input[type="text"], input:not([type])').forEach((el, i) => {
          inputs.push({
            type: 'input',
            index: i,
            className: el.className,
            placeholder: el.placeholder,
            visible: window.getComputedStyle(el).display !== 'none',
            rect: el.getBoundingClientRect()
          });
        });

        // Get contenteditable elements
        document.querySelectorAll('[contenteditable="true"]').forEach((el, i) => {
          inputs.push({
            type: 'contenteditable',
            index: i,
            className: el.className,
            visible: window.getComputedStyle(el).display !== 'none',
            rect: el.getBoundingClientRect()
          });
        });

        return JSON.stringify(inputs, null, 2);
      })()
    `;

    const inputsResult = await send("Runtime.evaluate", {
      expression: inputsExpr,
      returnByValue: true
    });

    console.log(inputsResult?.result?.value);

    // Look for existing AI conversations/messages
    console.log("\n\n=== Existing AI Messages ===\n");

    const messagesExpr = `
      (function() {
        const messages = [];

        // Look for message elements
        document.querySelectorAll('[class*="AI"][class*="message"], [class*="AI"][class*="Message"]').forEach(el => {
          messages.push({
            className: el.className,
            text: el.textContent?.slice(0, 200)
          });
        });

        // Also look for any existing AI threads
        document.querySelectorAll('[class*="AI"][class*="thread"], [class*="AI"][class*="Thread"]').forEach(el => {
          messages.push({
            className: el.className,
            text: el.textContent?.slice(0, 200)
          });
        });

        // Look in any scrollable container in the AI area
        const aiContainer = document.querySelector('.AISidebar');
        if (aiContainer) {
          const scrollables = aiContainer.querySelectorAll('[style*="overflow"], [class*="scroll"]');
          scrollables.forEach(s => {
            messages.push({
              type: 'scrollable',
              className: s.className,
              childCount: s.children.length,
              text: s.textContent?.slice(0, 500)
            });
          });
        }

        return JSON.stringify(messages, null, 2);
      })()
    `;

    const messagesResult = await send("Runtime.evaluate", {
      expression: messagesExpr,
      returnByValue: true
    });

    console.log(messagesResult?.result?.value);

    ws.close();
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    process.exit(1);
  });
}

main().catch(console.error);
