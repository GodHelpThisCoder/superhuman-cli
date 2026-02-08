/**
 * Trigger Ask AI by clicking the button or using keyboard shortcut
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

    // First, find the Ask AI button in the DOM
    console.log("Looking for Ask AI button...");

    const findButtonExpr = `
      (function() {
        // Try to find the Ask AI button
        const buttons = document.querySelectorAll('button, [role="button"], [data-testid*="ai"], [class*="ask-ai"], [class*="askAi"]');
        const results = [];

        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase() || '';
          const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
          const className = btn.className?.toLowerCase() || '';

          if (text.includes('ask ai') ||
              text.includes('askai') ||
              ariaLabel.includes('ai') ||
              className.includes('ai') ||
              className.includes('ask')) {
            results.push({
              tag: btn.tagName,
              text: btn.textContent?.slice(0, 50),
              ariaLabel: btn.getAttribute('aria-label'),
              className: btn.className?.slice(0, 100),
              id: btn.id
            });
          }
        }

        // Also look for any element with AI-related text
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          if (el.children.length === 0) {
            const text = el.textContent?.trim();
            if (text && (text.toLowerCase() === 'ask ai' || text.toLowerCase().includes('ask ai'))) {
              results.push({
                tag: el.tagName,
                text: text,
                parent: el.parentElement?.tagName,
                className: el.className?.slice(0, 100)
              });
            }
          }
        }

        return JSON.stringify(results, null, 2);
      })()
    `;

    const buttonResult = await send("Runtime.evaluate", {
      expression: findButtonExpr,
      returnByValue: true
    });

    console.log("Found elements:", buttonResult?.result?.value);

    // Try to find keyboard shortcut config
    console.log("\nLooking for keyboard shortcuts...");

    const shortcutExpr = `
      (function() {
        const results = {};

        // Look for key bindings in common patterns
        const shortcuts = [];

        // Check if there's a hotkey manager
        if (window.Mousetrap) {
          results.mousetrap = true;
        }

        // Look for handlers attached to keydown
        results.documentKeydown = !!document.onkeydown;

        // Look for Ask AI in the DOM that shows a shortcut
        const elements = document.querySelectorAll('[data-shortcut], [data-hotkey]');
        for (const el of elements) {
          shortcuts.push({
            shortcut: el.getAttribute('data-shortcut') || el.getAttribute('data-hotkey'),
            text: el.textContent?.slice(0, 50)
          });
        }

        results.shortcuts = shortcuts;

        // Check for command palette or similar
        const commandElements = document.querySelectorAll('[role="menu"], [role="listbox"], .command-palette');
        results.commandElements = commandElements.length;

        return JSON.stringify(results, null, 2);
      })()
    `;

    const shortcutResult = await send("Runtime.evaluate", {
      expression: shortcutExpr,
      returnByValue: true
    });

    console.log("Shortcuts:", shortcutResult?.result?.value);

    // Try pressing 'j' which is commonly used for AI
    console.log("\nTrying 'j' key...");
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "j",
      code: "KeyJ",
      text: "j",
      windowsVirtualKeyCode: 74,
      nativeVirtualKeyCode: 74
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "j",
      code: "KeyJ",
      windowsVirtualKeyCode: 74,
      nativeVirtualKeyCode: 74
    });

    await new Promise(r => setTimeout(r, 1000));

    // Check if any modal opened
    const modalCheckExpr = `
      (function() {
        const modals = document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="panel"], [class*="overlay"]');
        const visible = [];
        for (const m of modals) {
          const style = window.getComputedStyle(m);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            visible.push({
              tag: m.tagName,
              className: m.className?.slice(0, 100),
              ariaLabel: m.getAttribute('aria-label'),
              text: m.textContent?.slice(0, 100)
            });
          }
        }
        return JSON.stringify(visible, null, 2);
      })()
    `;

    const modalResult = await send("Runtime.evaluate", {
      expression: modalCheckExpr,
      returnByValue: true
    });

    console.log("Visible modals after 'j':", modalResult?.result?.value);

    // Let's try clicking on an element containing "Ask AI"
    console.log("\nTrying to click Ask AI element...");

    const clickExpr = `
      (function() {
        // Find clickable AI element
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          const text = el.textContent?.trim();
          if (text && (text === 'Ask AI' || text === 'Ask AI')) {
            // Found it, click the nearest clickable parent
            let clickable = el;
            while (clickable && !['BUTTON', 'A', 'DIV'].includes(clickable.tagName)) {
              clickable = clickable.parentElement;
            }
            if (clickable) {
              clickable.click();
              return { clicked: true, element: clickable.tagName, text: clickable.textContent?.slice(0, 50) };
            }
          }
        }

        // Also try looking for button with data-testid
        const aiButton = document.querySelector('[data-testid*="ai"], [data-testid*="ask"]');
        if (aiButton) {
          aiButton.click();
          return { clicked: true, element: aiButton.tagName, testId: aiButton.getAttribute('data-testid') };
        }

        return { clicked: false };
      })()
    `;

    const clickResult = await send("Runtime.evaluate", {
      expression: clickExpr,
      returnByValue: true
    });

    console.log("Click result:", clickResult?.result?.value);

    await new Promise(r => setTimeout(r, 2000));

    // Check for captured AI calls
    const capturedExpr = `
      (function() {
        return {
          capturedAIRequests: window.__capturedAIRequests || [],
          capturedAICalls: window._capturedAICalls || [],
          aiCaptureInstalled: window.__aiCaptureInstalled,
          aiCallInterceptorInstalled: window._aiCallInterceptorInstalled
        };
      })()
    `;

    const capturedResult = await send("Runtime.evaluate", {
      expression: capturedExpr,
      returnByValue: true
    });

    console.log("\nCaptured state:", JSON.stringify(capturedResult?.result?.value, null, 2));

    ws.close();
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    process.exit(1);
  });
}

main().catch(console.error);
