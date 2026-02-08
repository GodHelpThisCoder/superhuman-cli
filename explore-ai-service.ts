/**
 * Deep exploration of Ask AI service in Superhuman
 */

import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  console.log("=== Ask AI Service Exploration ===\n");

  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  const { Runtime } = conn;

  // First, list all AI-related services
  console.log("1. Finding AI-related services...\n");

  const services = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        if (!di?._services) return { error: 'No DI services found' };

        const aiServices = Object.keys(di._services).filter(k =>
          k.toLowerCase().includes('ai') ||
          k.toLowerCase().includes('ask') ||
          k.toLowerCase().includes('agent') ||
          k.toLowerCase().includes('sidebar')
        );

        return { aiServices };
      })()
    `,
    returnByValue: true
  });

  console.log("AI-related services:", JSON.stringify(services.result.value, null, 2));

  // Now explore each AI service
  console.log("\n2. Exploring AI services...\n");

  const exploration = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const results = {};

        const serviceNames = ['askAI', 'AIService', 'aiService', 'sidebarAI', 'sidebarAgent', 'SidebarAIAgent', 'ai', 'AIAgent'];

        for (const name of serviceNames) {
          try {
            const svc = di.get(name);
            if (svc) {
              results[name] = {
                type: typeof svc,
                keys: Object.keys(svc).slice(0, 30),
                proto: Object.getOwnPropertyNames(Object.getPrototypeOf(svc)).slice(0, 20)
              };
            }
          } catch (e) {
            // Service not found
          }
        }

        // Look for any service with 'ask' in method names
        const allServices = Object.keys(di._services);
        for (const svcName of allServices.slice(0, 100)) {
          try {
            const svc = di.get(svcName);
            if (svc && typeof svc === 'object') {
              const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(svc) || {});
              const hasAskMethod = methods.some(m =>
                m.toLowerCase().includes('ask') ||
                m.toLowerCase().includes('query') ||
                m.toLowerCase().includes('send')
              );
              if (hasAskMethod) {
                results[svcName + '_hasAskMethods'] = methods.filter(m =>
                  m.toLowerCase().includes('ask') ||
                  m.toLowerCase().includes('query') ||
                  m.toLowerCase().includes('send')
                );
              }
            }
          } catch {}
        }

        return results;
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("Service exploration:", JSON.stringify(exploration.result.value, null, 2));

  // Look for the ask AI presenter or controller
  console.log("\n3. Looking for Ask AI presenter/controller...\n");

  const presenter = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const results = {};

        // Look for presenter services
        const presenterServices = Object.keys(di._services).filter(k =>
          k.toLowerCase().includes('presenter') ||
          k.toLowerCase().includes('controller')
        );

        for (const name of presenterServices) {
          try {
            const svc = di.get(name);
            if (svc) {
              const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(svc) || {});
              if (methods.some(m => m.toLowerCase().includes('ai') || m.toLowerCase().includes('ask'))) {
                results[name] = methods;
              }
            }
          } catch {}
        }

        // Check ViewState for any AI-related state
        const viewState = window.ViewState;
        if (viewState) {
          const aiKeys = Object.keys(viewState).filter(k =>
            k.toLowerCase().includes('ai') ||
            k.toLowerCase().includes('ask') ||
            k.toLowerCase().includes('sidebar')
          );
          results.viewStateAIKeys = aiKeys;
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("Presenter exploration:", JSON.stringify(presenter.result.value, null, 2));

  // Look for analytics events that might reveal event ID format
  console.log("\n4. Checking analytics service for event tracking...\n");

  const analytics = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const results = {};

        try {
          const analytics = di.get('analytics');
          if (analytics) {
            results.analyticsKeys = Object.keys(analytics).slice(0, 30);
            results.analyticsMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(analytics) || {});

            // Check if there's an event queue or history
            if (analytics._events) {
              results.recentEvents = analytics._events.slice(-5);
            }
            if (analytics.events) {
              results.eventsQueue = analytics.events.slice?.(-5);
            }
          }
        } catch (e) {
          results.error = e.message;
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("Analytics exploration:", JSON.stringify(analytics.result.value, null, 2));

  // Try to find the shortId generator
  console.log("\n5. Looking for ID generation utilities...\n");

  const idGen = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Check for common ID generation patterns
        // Look in require/module system
        if (window.require) {
          try {
            const nanoid = window.require('nanoid');
            if (nanoid) results.nanoidAvailable = true;
          } catch {}

          try {
            const cuid = window.require('cuid');
            if (cuid) results.cuidAvailable = true;
          } catch {}
        }

        // Check if there's a shortId function somewhere
        const ga = window.GoogleAccount;
        const di = ga?.di;

        // Search through services for ID-related functions
        if (di?._services) {
          for (const [name, svc] of Object.entries(di._services)) {
            try {
              const instance = di.get(name);
              if (instance) {
                // Look for generate* methods
                const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(instance) || {});
                const genMethods = methods.filter(m =>
                  m.toLowerCase().includes('generate') ||
                  m.toLowerCase().includes('create') && m.toLowerCase().includes('id')
                );
                if (genMethods.length > 0) {
                  results[name + '_methods'] = genMethods;
                }
              }
            } catch {}
          }
        }

        // Check the team ID format for clues
        const teamId = ga?.accountStore?.state?.account?.settings?._cache?.pseudoTeamId;
        if (teamId) {
          const suffix = teamId.replace('team_', '');
          results.teamId = teamId;
          results.teamIdSuffix = suffix;
          results.teamIdSuffixLength = suffix.length;
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("ID generation exploration:", JSON.stringify(idGen.result.value, null, 2));

  // Check if there's an open Ask AI sidebar we can inspect
  console.log("\n6. Checking for open Ask AI sidebar state...\n");

  const sidebarState = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Look for sidebar elements in DOM
        const sidebar = document.querySelector('[class*="sidebar"]');
        if (sidebar) {
          results.sidebarFound = true;
          results.sidebarClasses = sidebar.className;
        }

        // Look for AI chat elements
        const aiChat = document.querySelector('[class*="ai"]') || document.querySelector('[class*="Ask"]');
        if (aiChat) {
          results.aiChatFound = true;
          results.aiChatClasses = aiChat.className;
        }

        // Check ViewState for sidebar state
        const viewState = window.ViewState;
        if (viewState) {
          for (const [key, value] of Object.entries(viewState)) {
            if (key.toLowerCase().includes('sidebar') || key.toLowerCase().includes('ai')) {
              results['viewState.' + key] = typeof value === 'object' ? Object.keys(value || {}).slice(0, 10) : typeof value;
            }
          }
        }

        // Look for React components that might have Ask AI state
        const root = document.getElementById('root');
        if (root) {
          const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber'));
          if (fiberKey) {
            results.reactFiberFound = true;
          }
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("Sidebar state:", JSON.stringify(sidebarState.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
