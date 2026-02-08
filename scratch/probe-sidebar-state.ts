/**
 * Quick probe to get full sidebarAIAgent state and understand session structure.
 */

import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

const CDP_PORT = 9333;

async function main() {
  const conn = await connectToSuperhuman(CDP_PORT);
  if (!conn) { console.error("Failed to connect."); process.exit(1); }

  const { Runtime } = conn;

  // 1. Full sidebarAIAgent state
  console.log("=== sidebarAIAgent Full State ===\n");
  const sidebarResult = await Runtime.evaluate({
    expression: `
      (() => {
        const tree = window.ViewState?.tree;
        const data = tree?.get?.() || tree?._data;
        return JSON.stringify(data?.sidebarAIAgent, null, 2);
      })()
    `,
    returnByValue: true,
  });
  console.log(sidebarResult.result.value);

  // 2. Agent sessions
  console.log("\n=== Agent Sessions State ===\n");
  const agentResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.agentSessions) return "No agentSessions";
        const as = ga.agentSessions;
        const proto = Object.getPrototypeOf(as);
        return JSON.stringify({
          constructorName: as.constructor?.name,
          methods: proto ? Object.getOwnPropertyNames(proto).filter(m => typeof proto[m] === 'function' && m !== 'constructor') : [],
          ownKeys: Object.keys(as),
        }, null, 2);
      })()
    `,
    returnByValue: true,
  });
  console.log(agentResult.result.value);

  // 3. Full list of aiAgentSessionStates
  console.log("\n=== AI Agent Session States ===\n");
  const sessionStatesResult = await Runtime.evaluate({
    expression: `
      (() => {
        const tree = window.ViewState?.tree;
        const data = tree?.get?.() || tree?._data;
        return JSON.stringify(data?.aiAgentSessionStates, null, 2);
      })()
    `,
    returnByValue: true,
  });
  console.log(sessionStatesResult.result.value);

  // 4. Look at what ASK_AI command actually does
  console.log("\n=== ASK_AI Command Source ===\n");
  const askAiCmdResult = await Runtime.evaluate({
    expression: `
      (() => {
        const rc = window.ViewState?.regionalCommands;
        if (!rc) return "No regionalCommands";
        const sources = [];
        for (const region of rc) {
          if (region?.commands) {
            for (const cmd of region.commands) {
              if (cmd.id === 'ASK_AI' || cmd.id === 'NEW_AI_CONVERSATION' || cmd.id === 'WRITE_WITH_AI') {
                sources.push({
                  id: cmd.id,
                  source: cmd.action?.toString()?.substring(0, 2000) || 'no action',
                  keys: Object.keys(cmd),
                });
              }
            }
          }
        }
        return JSON.stringify(sources, null, 2);
      })()
    `,
    returnByValue: true,
  });
  console.log(askAiCmdResult.result.value);

  // 5. Check if there's a way to trigger the sidebar programmatically
  console.log("\n=== Sidebar AI Agent Controller/Presenter ===\n");
  const presenterResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const vs = window.ViewState;

        // Search for sidebar or agent presenter
        const results = {};

        // Check ViewState for presenter references
        for (const key of Object.keys(vs)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('sidebar') || lowerKey.includes('agent') || lowerKey.includes('aipresenter') || lowerKey.includes('aicontroller')) {
            const val = vs[key];
            if (val && typeof val === 'object') {
              const proto = Object.getPrototypeOf(val);
              results[key] = {
                constructor: val.constructor?.name,
                protoMethods: proto ? Object.getOwnPropertyNames(proto)
                  .filter(m => typeof proto[m] === 'function' && m !== 'constructor').slice(0, 30) : [],
                ownKeys: Object.keys(val).slice(0, 20),
              };
            } else {
              results[key] = { type: typeof val, value: String(val).substring(0, 200) };
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });
  console.log(JSON.stringify(presenterResult.result.value, null, 2));

  // 6. Check aiComposeAgentic parameters from the minified source
  console.log("\n=== aiComposeAgentic Full Signature ===\n");
  const agenticResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.backend) return "No backend";
        const proto = Object.getPrototypeOf(ga.backend);
        if (!proto?.aiComposeAgentic) return "No aiComposeAgentic";
        return proto.aiComposeAgentic.toString();
      })()
    `,
    returnByValue: true,
  });
  console.log(agenticResult.result.value);

  // 7. Check aiComposeEdit full signature
  console.log("\n=== aiComposeEdit Full Signature ===\n");
  const editResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.backend) return "No backend";
        const proto = Object.getPrototypeOf(ga.backend);
        if (!proto?.aiComposeEdit) return "No aiComposeEdit";
        return proto.aiComposeEdit.toString();
      })()
    `,
    returnByValue: true,
  });
  console.log(editResult.result.value);

  // 8. Check _streamAgenticResponse to understand the SSE format
  console.log("\n=== _streamAgenticResponse Source ===\n");
  const streamResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.backend) return "No backend";
        const proto = Object.getPrototypeOf(ga.backend);
        if (!proto?._streamAgenticResponse) return "No _streamAgenticResponse";
        return proto._streamAgenticResponse.toString();
      })()
    `,
    returnByValue: true,
  });
  console.log(streamResult.result.value);

  // 9. Check _streamResponse too
  console.log("\n=== _streamResponse Source ===\n");
  const streamRespResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.backend) return "No backend";
        const proto = Object.getPrototypeOf(ga.backend);
        if (!proto?._streamResponse) return "No _streamResponse";
        return proto._streamResponse.toString();
      })()
    `,
    returnByValue: true,
  });
  console.log(streamRespResult.result.value);

  // 10. Check what action_type values are referenced in the codebase
  console.log("\n=== Search for action_type values in app bundle ===\n");
  const actionTypeResult = await Runtime.evaluate({
    expression: `
      (() => {
        // Try to find action_type enum/values by searching performance entries or service worker cache
        // Also look at the sidebar session history for clues about what actions were used
        const tree = window.ViewState?.tree;
        const data = tree?.get?.() || tree?._data;
        const sidebar = data?.sidebarAIAgent;

        const results = {
          sessionHistoryCount: sidebar?.sessionHistoryList?.length || 0,
          recentSessions: (sidebar?.sessionHistoryList || []).slice(0, 5).map(s => ({
            id: s.id,
            title: s.title,
            updatedAt: new Date(s.updatedAt).toISOString(),
          })),
          currentPage: sidebar?.uiState?.page,
          currentSessionId: sidebar?.sessionId,
          context: sidebar?.context,
          createDraftData: sidebar?.createDraftData,
        };

        return JSON.stringify(results, null, 2);
      })()
    `,
    returnByValue: true,
  });
  console.log(actionTypeResult.result.value);

  await disconnect(conn);
  console.log("\nDone.");
}

main().catch(console.error);
