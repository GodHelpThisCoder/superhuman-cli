/**
 * Investigate how Superhuman generates question_event_id for the agentic endpoint.
 *
 * The question_event_id is required by ai.composeAgentic and we need to understand
 * its format. This script:
 * 1. Looks at existing session events in Firestore/local storage
 * 2. Intercepts the generation function
 * 3. Tries to call the generation function directly
 */

import { connectToSuperhuman, disconnect } from "../src/superhuman-api";
import { getCurrentAccount } from "../src/accounts";
import { extractSuperhumanToken, extractUserPrefix } from "../src/token-api";

const CDP_PORT = 9333;
const SUPERHUMAN_BACKEND_BASE = "https://mail.superhuman.com/~backend";

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(CDP_PORT);

  if (!conn) {
    console.error("Failed to connect.");
    process.exit(1);
  }

  const { Runtime } = conn;

  const email = await getCurrentAccount(conn);
  if (!email) { console.error("No account."); process.exit(1); }
  console.log(`Account: ${email}`);

  const tokenInfo = await extractSuperhumanToken(conn, email);
  const userPrefix = await extractUserPrefix(conn);
  console.log(`User prefix: ${userPrefix}`);

  // 1. Look for existing session data that might contain event IDs
  console.log("\n=== Look for Event IDs in Agent Session Data ===\n");

  const sessionDataResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.agentSessions) return "No agentSessions";

        // Try to get a recent session
        const tree = window.ViewState?.tree;
        const data = tree?.get?.() || tree?._data;
        const sidebar = data?.sidebarAIAgent;
        const sessions = sidebar?.sessionHistoryList || [];

        if (sessions.length === 0) return "No sessions";

        // Try to load the first session
        const firstId = sessions[0].id;
        const session = ga.agentSessions.getSession(firstId);

        return JSON.stringify({
          sessionId: firstId,
          sessionData: session,
          sessionType: typeof session,
          sessionKeys: session ? Object.keys(session) : [],
        }, null, 2);
      })()
    `,
    returnByValue: true,
  });
  console.log(sessionDataResult.result.value);

  // 2. Look for the ShortId / event ID generator in the app
  console.log("\n=== Search for ShortId Generator ===\n");

  const shortIdResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const results = {};

        // Check if there's a ShortId service
        if (ga?.di?._services) {
          for (const [key, val] of Object.entries(ga.di._services)) {
            const lk = key.toLowerCase();
            if (lk.includes('shortid') || lk.includes('short_id') || lk.includes('eventid') || lk.includes('event_id') || lk.includes('cuid') || lk.includes('uuid') || lk.includes('idgen')) {
              results['di.' + key] = typeof val;
            }
          }
        }

        // Check known locations
        const checks = [
          ['ga.shortIdGenerator', ga?.shortIdGenerator],
          ['ga.idGenerator', ga?.idGenerator],
          ['ga.eventIdGenerator', ga?.eventIdGenerator],
          ['ga.ShortId', ga?.ShortId],
        ];

        for (const [name, val] of checks) {
          if (val) {
            results[name] = {
              type: typeof val,
              constructor: val?.constructor?.name,
              methods: typeof val === 'object'
                ? Object.getOwnPropertyNames(Object.getPrototypeOf(val) || {}).filter(m => m !== 'constructor')
                : [],
            };
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });
  console.log(JSON.stringify(shortIdResult.result.value, null, 2));

  // 3. Monkey-patch fetch to intercept the next ai.composeAgentic call
  console.log("\n=== Installing Fetch Interceptor ===\n");

  await Runtime.evaluate({
    expression: `
      (() => {
        if (!window._originalFetch) {
          window._originalFetch = window.fetch;
        }
        window._capturedAgenticCalls = [];

        window.fetch = function(...args) {
          const [url, opts] = args;
          const urlStr = typeof url === 'string' ? url : url?.url || '';

          if (urlStr.includes('ai.compose') || urlStr.includes('ai.ask') || urlStr.includes('userdata')) {
            try {
              const body = opts?.body ? JSON.parse(opts.body) : null;
              window._capturedAgenticCalls.push({
                url: urlStr,
                method: opts?.method || 'GET',
                body,
                timestamp: Date.now(),
              });
            } catch {}
          }

          return window._originalFetch.apply(this, args);
        };

        return "Interceptor installed";
      })()
    `,
    returnByValue: true,
  });
  console.log("Fetch interceptor installed.");

  // 4. Try to trigger ASK_AI command programmatically
  console.log("\n=== Triggering ASK_AI Command ===\n");

  const triggerResult = await Runtime.evaluate({
    expression: `
      (() => {
        const rc = window.ViewState?.regionalCommands;
        if (!rc) return "No regionalCommands";

        for (const region of rc) {
          if (region?.commands) {
            for (const cmd of region.commands) {
              if (cmd.id === 'ASK_AI' && typeof cmd.action === 'function') {
                const mockEvent = {
                  preventDefault: () => {},
                  stopPropagation: () => {},
                };
                try {
                  cmd.action(mockEvent);
                  return "ASK_AI triggered";
                } catch (e) {
                  return "Error: " + e.message;
                }
              }
            }
          }
        }
        return "ASK_AI not found";
      })()
    `,
    returnByValue: true,
  });
  console.log(triggerResult.result.value);

  // Wait for sidebar to open
  await new Promise(r => setTimeout(r, 2000));

  // 5. Check sidebar state after triggering
  console.log("\n=== Sidebar State After Trigger ===\n");

  const stateAfterResult = await Runtime.evaluate({
    expression: `
      (() => {
        const tree = window.ViewState?.tree;
        const data = tree?.get?.() || tree?._data;
        const sidebar = data?.sidebarAIAgent;
        return JSON.stringify({
          show: sidebar?.show,
          page: sidebar?.uiState?.page,
          sessionId: sidebar?.sessionId,
          context: sidebar?.context,
          createDraftData: sidebar?.createDraftData,
          isExistingSession: sidebar?.isExistingSession,
        }, null, 2);
      })()
    `,
    returnByValue: true,
  });
  console.log(stateAfterResult.result.value);

  // 6. Check captured calls
  console.log("\n=== Captured API Calls ===\n");

  const capturedResult = await Runtime.evaluate({
    expression: `
      JSON.stringify(window._capturedAgenticCalls || [], null, 2)
    `,
    returnByValue: true,
  });
  console.log(capturedResult.result.value);

  // 7. Now let's look deeper - find how question_event_id is generated by searching for ShortId
  console.log("\n=== Deep Search for Event ID Generation ===\n");

  const deepSearchResult = await Runtime.evaluate({
    expression: `
      (() => {
        // Search all properties recursively looking for anything that generates event IDs
        const ga = window.GoogleAccount;
        const results = {};

        // Check if there's a labels._settings that has userId (for the prefix)
        const userId = ga?.labels?._settings?._cache?.userId;
        results.userId = userId;

        if (userId) {
          const suffix = userId.replace('user_', '');
          results.userPrefix = suffix.length >= 11 ? suffix.substring(7, 11) : 'too short';
        }

        // Look for cuid or similar in the DI
        if (ga?.di?.get) {
          const serviceNames = ['shortId', 'ShortId', 'id', 'cuid', 'eventId', 'questionEventId'];
          for (const name of serviceNames) {
            try {
              const svc = ga.di.get(name);
              if (svc) {
                results['di.get("' + name + '")'] = {
                  type: typeof svc,
                  value: typeof svc === 'string' ? svc : typeof svc === 'function' ? svc.toString().substring(0, 500) : JSON.stringify(svc).substring(0, 500),
                };
              }
            } catch {}
          }
        }

        // Check if there's a _generateId or similar method on the backend
        const backendProto = ga?.backend ? Object.getPrototypeOf(ga.backend) : null;
        if (backendProto) {
          const idMethods = Object.getOwnPropertyNames(backendProto)
            .filter(m => {
              const lm = m.toLowerCase();
              return (lm.includes('id') || lm.includes('event') || lm.includes('generate') || lm.includes('create')) && typeof backendProto[m] === 'function';
            });
          results.backendIdMethods = idMethods;
        }

        return JSON.stringify(results, null, 2);
      })()
    `,
    returnByValue: true,
  });
  console.log(deepSearchResult.result.value);

  // 8. Try to find the actual ShortId function in the webpack modules
  console.log("\n=== Search Webpack Modules for ShortId ===\n");

  const webpackResult = await Runtime.evaluate({
    expression: `
      (() => {
        // Try common webpack module patterns
        const results = {};

        // Check for webpackJsonp or __webpack_modules__
        if (window.webpackJsonp) {
          results.hasWebpackJsonp = true;
        }
        if (window.__webpack_modules__) {
          results.hasWebpackModules = true;
          results.moduleCount = Object.keys(window.__webpack_modules__).length;
        }

        // Look for the ShortId class in global scope variations
        const globalChecks = [
          'ShortId', 'shortId', 'SHORT_ID',
          'cuid', 'CUID', 'nanoid',
        ];
        for (const name of globalChecks) {
          if (window[name]) {
            results[name] = typeof window[name];
          }
        }

        return JSON.stringify(results, null, 2);
      })()
    `,
    returnByValue: true,
  });
  console.log(webpackResult.result.value);

  // 9. Try generating an event ID using the approach from Superhuman's codebase
  // Based on prior investigation, event IDs follow: event_11V{4random}{userPrefix}{7random}
  console.log("\n=== Try ai.composeAgentic with Properly Formatted Event ID ===\n");

  // Generate event ID in Superhuman's format
  const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  function randomBase62(length: number): string {
    let result = "";
    for (let i = 0; i < length; i++) {
      result += BASE62.charAt(Math.floor(Math.random() * BASE62.length));
    }
    return result;
  }

  // Try various event ID formats
  const eventIdFormats = [
    // Standard format from prior investigation
    `event_11V${randomBase62(4)}${userPrefix || 'XXXX'}${randomBase62(7)}`,
    // Just random event
    `event_${randomBase62(18)}`,
    // UUID-based
    `event_${crypto.randomUUID()}`,
    // Try with "11v" lowercase
    `event_11v${randomBase62(4)}${userPrefix || 'XXXX'}${randomBase62(7)}`,
    // Try shorter format
    `event_${randomBase62(12)}`,
  ];

  for (const eventId of eventIdFormats) {
    console.log(`\nTrying event ID: ${eventId}`);

    const payload = {
      instructions: "Write a short email about scheduling a meeting",
      session_id: crypto.randomUUID(),
      local_datetime: new Date().toISOString(),
      question_event_id: eventId,
      user: { name: "Test", email: email },
      draft_action: "compose",
      content: "",
      content_type: "text/html",
      thread_id: "",
      last_message_id: "",
      thread_content: "",
      subject: "",
      to: [],
      cc: [],
      bcc: [],
      interactive: false,
      selected_text: "",
      retry_count: 0,
      draft_id: "",
    };

    try {
      const response = await fetch(`${SUPERHUMAN_BACKEND_BASE}/v3/ai.composeAgentic`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenInfo.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const status = response.status;
      if (status === 200) {
        const text = await response.text();
        const preview = text.split("\n").filter(l => l.startsWith("data: ")).slice(0, 3).join("\n");
        console.log(`  SUCCESS (200)! Preview: ${preview.substring(0, 400)}`);
      } else {
        const errorText = await response.text();
        console.log(`  FAILED (${status}): ${errorText.substring(0, 300)}`);
      }
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // 10. Clean up interceptor
  await Runtime.evaluate({
    expression: `
      (() => {
        if (window._originalFetch) {
          window.fetch = window._originalFetch;
          delete window._originalFetch;
        }
        return "Cleaned up";
      })()
    `,
    returnByValue: true,
  });

  // 11. Check captured calls after all activity
  console.log("\n=== Final Captured API Calls ===\n");

  const finalCapturedResult = await Runtime.evaluate({
    expression: `
      JSON.stringify(window._capturedAgenticCalls || [], null, 2)
    `,
    returnByValue: true,
  });
  console.log(finalCapturedResult.result.value);

  await disconnect(conn);
  console.log("\nDone.");
}

main().catch(console.error);
