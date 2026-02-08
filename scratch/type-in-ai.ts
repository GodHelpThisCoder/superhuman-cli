/**
 * Type in the AI editor and submit
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
  const capturedRequests: any[] = [];

  // Listen for network events
  ws.on("message", (data: any) => {
    const msg = JSON.parse(data.toString());

    if (msg.method === "Network.requestWillBeSent") {
      const { request } = msg.params;
      const { url, postData } = request;

      // Check all requests to superhuman
      if (url.includes("superhuman.com") && postData) {
        try {
          const body = JSON.parse(postData);
          const bodyStr = JSON.stringify(body);
          if (bodyStr.includes("question_event") ||
              bodyStr.includes("session_id") ||
              bodyStr.includes("askAI") ||
              bodyStr.includes("ai.") ||
              bodyStr.includes("agent")) {
            console.log(`\n[CAPTURED] ${url}`);
            console.log("Body:", JSON.stringify(body, null, 2).slice(0, 2000));
            capturedRequests.push({ url, body });
          }
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

    // Find and inspect the AI editor
    console.log("\n=== Inspecting AI Editor ===\n");

    const editorExpr = `
      (function() {
        const editor = document.querySelector('.AIAgent-input-editor-scroll');
        if (!editor) return { found: false };

        // Get the simplebar content area
        const content = editor.querySelector('.simplebar-content-wrapper');
        if (!content) return { found: true, noContent: true };

        // Get children
        const children = content.querySelector('.simplebar-content')?.children || [];
        const childInfo = [];
        for (const child of children) {
          childInfo.push({
            tag: child.tagName,
            className: child.className,
            contentEditable: child.contentEditable,
            innerHTML: child.innerHTML?.slice(0, 200)
          });
        }

        return {
          found: true,
          contentChildren: Array.from(children).length,
          children: childInfo,
          editorHTML: editor.innerHTML.slice(0, 1000)
        };
      })()
    `;

    const editorResult = await send("Runtime.evaluate", {
      expression: editorExpr,
      returnByValue: true
    });

    console.log("Editor structure:", JSON.stringify(editorResult?.result?.value, null, 2));

    // Look for the actual editable element
    console.log("\n=== Looking for editable element ===\n");

    const editableExpr = `
      (function() {
        // Find contenteditable elements
        const editables = document.querySelectorAll('[contenteditable="true"]');
        const results = [];

        for (const el of editables) {
          const rect = el.getBoundingClientRect();
          results.push({
            tag: el.tagName,
            className: el.className,
            innerHTML: el.innerHTML?.slice(0, 100),
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
          });
        }

        return JSON.stringify(results, null, 2);
      })()
    `;

    const editableResult = await send("Runtime.evaluate", {
      expression: editableExpr,
      returnByValue: true
    });

    console.log("Contenteditable elements:", editableResult?.result?.value);

    // Find any element with editor in the class name within AISidebar
    console.log("\n=== Looking for editor elements in AISidebar ===\n");

    const aiEditorExpr = `
      (function() {
        const sidebar = document.querySelector('.AISidebar');
        if (!sidebar) return 'No sidebar';

        const elements = sidebar.querySelectorAll('[class*="editor"], [class*="Editor"], [class*="input"], [class*="Input"]');
        const results = [];

        for (const el of elements) {
          results.push({
            tag: el.tagName,
            className: el.className,
            children: el.children.length,
            innerHTML: el.innerHTML?.slice(0, 100)
          });
        }

        return JSON.stringify(results, null, 2);
      })()
    `;

    const aiEditorResult = await send("Runtime.evaluate", {
      expression: aiEditorExpr,
      returnByValue: true
    });

    console.log("AI Editor elements:", aiEditorResult?.result?.value);

    // Try to focus and use insertText
    console.log("\n=== Focusing AI input and inserting text ===\n");

    // First click on the input container to focus it
    const focusExpr = `
      (function() {
        const inputContainer = document.querySelector('.AIAgent-input-container');
        if (inputContainer) {
          inputContainer.click();
          return { clicked: 'inputContainer' };
        }
        return { clicked: false };
      })()
    `;

    await send("Runtime.evaluate", { expression: focusExpr });
    await new Promise(r => setTimeout(r, 500));

    // Now use Input.insertText
    console.log("Inserting text via CDP...");
    await send("Input.insertText", { text: "What is this email about?" });

    await new Promise(r => setTimeout(r, 500));

    // Check if text was inserted
    const checkTextExpr = `
      (function() {
        const sidebar = document.querySelector('.AISidebar');
        if (!sidebar) return 'No sidebar';

        // Check all text content
        const textContent = sidebar.textContent;
        const hasQuestion = textContent.includes('What is this email about');

        return { hasQuestion, textContent: textContent.slice(0, 500) };
      })()
    `;

    const checkResult = await send("Runtime.evaluate", {
      expression: checkTextExpr,
      returnByValue: true
    });

    console.log("Text check:", checkResult?.result?.value);

    // Press Enter to submit
    console.log("\nPressing Enter to submit...");
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

    // Wait for request
    console.log("\nWaiting for AI request (10 seconds)...");
    await new Promise(r => setTimeout(r, 10000));

    // Summary
    console.log("\n=== SUMMARY ===\n");
    console.log(`Captured ${capturedRequests.length} AI-related requests`);
    for (const req of capturedRequests) {
      console.log("\nURL:", req.url);
      if (req.body.question_event_id) {
        console.log("question_event_id:", req.body.question_event_id);
      }
      if (req.body.session_id) {
        console.log("session_id:", req.body.session_id);
      }
      if (req.body.agent_session_id) {
        console.log("agent_session_id:", req.body.agent_session_id);
      }
    }

    // Also check the captured requests in window
    const windowCapturedExpr = `
      (function() {
        return {
          capturedAIRequests: window.__capturedAIRequests || [],
          capturedAICalls: window._capturedAICalls || []
        };
      })()
    `;

    const windowCaptured = await send("Runtime.evaluate", {
      expression: windowCapturedExpr,
      returnByValue: true
    });

    console.log("\nWindow captured:", JSON.stringify(windowCaptured?.result?.value, null, 2));

    ws.close();
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    process.exit(1);
  });
}

main().catch(console.error);
