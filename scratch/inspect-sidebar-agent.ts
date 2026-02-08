/**
 * Deep inspect the sidebarAIAgent state and how it triggers requests
 */
import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { process.exit(1); }
  const { Runtime } = conn;

  // 1. Get full sidebarAIAgent state
  console.log("=== sidebarAIAgent State ===\n");
  const state = await Runtime.evaluate({
    expression: `JSON.stringify(window.ViewState?.tree?.sidebarAIAgent, null, 2)`,
    returnByValue: true
  });
  console.log(state.result.value);

  // 2. Get session history details
  console.log("\n=== Session History ===\n");
  const history = await Runtime.evaluate({
    expression: `
      (() => {
        const agent = window.ViewState?.tree?.sidebarAIAgent;
        if (!agent?.sessionHistoryList) return 'No session history';
        return JSON.stringify(agent.sessionHistoryList.slice(0, 5), null, 2);
      })()
    `,
    returnByValue: true
  });
  console.log(history.result.value);

  // 3. Get agentSessions service details
  console.log("\n=== AgentSessions Service ===\n");
  const sessions = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        if (!di) return 'No DI container';

        // Try to get agentSessions service
        const svcNames = ['agentSessions', 'AgentSessions', 'agent_sessions'];
        for (const name of svcNames) {
          try {
            const svc = di.get(name);
            if (svc) {
              const proto = Object.getPrototypeOf(svc);
              const methods = Object.getOwnPropertyNames(proto).filter(m => m !== 'constructor');
              return JSON.stringify({
                serviceName: name,
                methods,
                ownKeys: Object.keys(svc),
                // Try to get current session
                hasStartLocalSession: typeof svc.startLocalSession === 'function',
                hasGetSession: typeof svc.getSession === 'function',
              }, null, 2);
            }
          } catch {}
        }
        return 'agentSessions service not found';
      })()
    `,
    returnByValue: true
  });
  console.log(sessions.result.value);

  // 4. Look for how the sidebar sends messages
  console.log("\n=== Sidebar Command Handlers ===\n");
  const commands = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const vs = window.ViewState;
        const results = {};

        // Check regional commands related to AI
        if (vs?.regionalCommands) {
          results.aiCommands = vs.regionalCommands
            .filter(c => c.id?.includes('AI'))
            .map(c => ({ id: c.id, label: c.label, hasAction: c.hasAction }));
        }

        // Look for the handler that processes ASK_AI command
        // Check if there's a command handler registry
        if (vs?._commandHandlers) {
          results.handlerKeys = Object.keys(vs._commandHandlers).filter(k =>
            k.includes('AI') || k.includes('ai') || k.includes('ask')
          );
        }

        // Check for the sidebar presenter/controller
        const di = ga?.di;
        if (di) {
          const sidebarNames = ['sidebarAI', 'sidebarAgent', 'SidebarAIAgent',
                                'sidebarPresenter', 'aiSidebar', 'aiAgent',
                                'askAI', 'askAIPresenter'];
          for (const name of sidebarNames) {
            try {
              const svc = di.get(name);
              if (svc) {
                const proto = Object.getPrototypeOf(svc);
                results[name] = Object.getOwnPropertyNames(proto).filter(m => m !== 'constructor');
              }
            } catch {}
          }
        }

        return results;
      })()
    `,
    returnByValue: true
  });
  console.log(JSON.stringify(commands.result.value, null, 2));

  // 5. Look at the actual AI compose method params more carefully for threadless use
  console.log("\n=== aiCompose signature analysis ===\n");
  const compose = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const backend = ga?.backend;
        if (!backend) return 'no backend';
        const proto = Object.getPrototypeOf(backend);

        // Get the full aiCompose source
        const src = proto.aiCompose.toString();

        // Also get aiComposeAgentic and _streamAgenticResponse
        const agenticSrc = proto.aiComposeAgentic.toString();
        const streamSrc = proto._streamAgenticResponse.toString();

        return {
          aiCompose: src,
          aiComposeAgentic: agenticSrc.substring(0, 2000),
          _streamAgenticResponse: streamSrc,
        };
      })()
    `,
    returnByValue: true
  });
  console.log(JSON.stringify(compose.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
