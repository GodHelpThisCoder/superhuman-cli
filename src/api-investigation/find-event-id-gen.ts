/**
 * Find the event ID generator in Superhuman
 *
 * We know the pattern is: event_11VNPxxxxxx
 * - event_ prefix
 * - 11VNP appears to be static for this user
 * - remaining chars are timestamp + random (Push ID style)
 *
 * This script will:
 * 1. Search for the "11VNP" string in the app state
 * 2. Look for ShortId, PushId, or similar ID generators
 * 3. Try to find where event IDs are generated
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime } = conn;

  console.log("=== Step 1: Search for '11VNP' in app state ===\n");

  // Search for the known prefix pattern
  const prefixSearchResult = await Runtime.evaluate({
    expression: `
      (() => {
        const results = [];
        const searchTerm = '11VNP';

        // Deep search function
        function searchObject(obj, path, depth = 0, seen = new WeakSet()) {
          if (depth > 8 || !obj || typeof obj !== 'object') return;
          if (seen.has(obj)) return;
          seen.add(obj);

          try {
            for (const [key, value] of Object.entries(obj)) {
              if (typeof value === 'string') {
                if (value.includes(searchTerm) || value.includes('event_11')) {
                  results.push({ path: path + '.' + key, value: value.substring(0, 50) });
                }
              } else if (typeof value === 'object' && value !== null) {
                searchObject(value, path + '.' + key, depth + 1, seen);
              }
            }
          } catch {}
        }

        // Search main objects
        const ga = window.GoogleAccount;
        searchObject(ga, 'GoogleAccount', 0);
        searchObject(ga?.accountStore?.state, 'accountStore.state', 0);
        searchObject(ga?.backend, 'backend', 0);

        // Also check local storage
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            if (value?.includes(searchTerm) || value?.includes('event_11')) {
              results.push({
                path: 'localStorage.' + key,
                value: value.substring(0, 100)
              });
            }
          }
        } catch {}

        return results.slice(0, 20);
      })()
    `,
    returnByValue: true,
  });

  console.log("Found references to prefix:");
  console.log(JSON.stringify(prefixSearchResult.result.value, null, 2));

  console.log("\n=== Step 2: Search for ShortId/PushId generators ===\n");

  // Look for ID generators
  const idGenSearchResult = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};
        const ga = window.GoogleAccount;
        const di = ga?.di;

        // List all services in DI
        if (di?._services) {
          results.allServices = Object.keys(di._services);
        }

        // Try common ID generator names
        const idNames = [
          'ShortId', 'shortId', 'SHORTID',
          'PushId', 'pushId', 'PUSHID',
          'IdGenerator', 'idGenerator', 'ID_GENERATOR',
          'EventId', 'eventId', 'EVENT_ID',
          'UniqueId', 'uniqueId', 'UNIQUE_ID',
          'Uuid', 'uuid', 'UUID',
          'Cuid', 'cuid', 'CUID',
          'NanoId', 'nanoid', 'NANOID',
        ];

        results.foundGenerators = [];
        for (const name of idNames) {
          try {
            const svc = di?.get?.(name);
            if (svc) {
              const type = typeof svc;
              let sample = null;
              if (type === 'function') {
                try { sample = svc(); } catch {}
              } else if (type === 'object' && typeof svc.generate === 'function') {
                try { sample = svc.generate(); } catch {}
              } else if (type === 'object' && typeof svc.next === 'function') {
                try { sample = svc.next(); } catch {}
              } else if (type === 'object' && typeof svc.id === 'function') {
                try { sample = svc.id(); } catch {}
              }
              results.foundGenerators.push({ name, type, sample });
            }
          } catch {}
        }

        // Also look in window for ID generators
        results.windowIdGenerators = [];
        for (const key of Object.keys(window)) {
          if (key.toLowerCase().includes('shortid') ||
              key.toLowerCase().includes('pushid') ||
              key.toLowerCase().includes('nanoid') ||
              key.toLowerCase().includes('cuid')) {
            results.windowIdGenerators.push({
              key,
              type: typeof window[key]
            });
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("ID Generator search:");
  console.log(JSON.stringify(idGenSearchResult.result.value, null, 2));

  console.log("\n=== Step 3: Look for user-specific prefix in settings ===\n");

  // The prefix might be stored in user settings
  const userPrefixResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const account = ga?.accountStore?.state?.account;
        const settings = account?.settings;
        const user = ga?.accountStore?.state?.user;

        const result = {
          pseudoTeamId: settings?._cache?.pseudoTeamId,
          userId: user?.id,
          googleId: ga?.credential?._authData?.googleId,
          accountId: account?.id,
        };

        // Look for any property with "11VNP" or similar pattern
        if (user) {
          for (const [key, value] of Object.entries(user)) {
            if (typeof value === 'string' && value.length < 50) {
              result['user_' + key] = value;
            }
          }
        }

        // Check credential for any IDs
        const authData = ga?.credential?._authData;
        if (authData) {
          for (const [key, value] of Object.entries(authData)) {
            if (key !== 'accessToken' && key !== 'idToken' && typeof value === 'string' && value.length < 50) {
              result['auth_' + key] = value;
            }
          }
        }

        return result;
      })()
    `,
    returnByValue: true,
  });

  console.log("User-specific IDs:");
  console.log(JSON.stringify(userPrefixResult.result.value, null, 2));

  console.log("\n=== Step 4: Intercept an actual event ID generation ===\n");

  // Install interceptor for any calls that might generate event IDs
  await Runtime.evaluate({
    expression: `
      (function() {
        window._eventIdCaptures = [];

        // Watch for property sets containing "event_"
        const originalDefineProperty = Object.defineProperty;
        Object.defineProperty = function(obj, prop, descriptor) {
          if (descriptor?.value && typeof descriptor.value === 'string' && descriptor.value.startsWith('event_')) {
            window._eventIdCaptures.push({
              type: 'defineProperty',
              prop,
              value: descriptor.value,
              stack: new Error().stack?.slice(0, 500)
            });
          }
          return originalDefineProperty.apply(this, arguments);
        };

        console.log('Event ID interceptor installed');
      })()
    `,
  });

  console.log("Interceptor installed.");

  console.log("\n=== Step 5: Check backend methods for ID generation ===\n");

  const backendMethodsResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const backend = ga?.backend;

        if (!backend) return { error: 'No backend' };

        // Get prototype methods
        const proto = Object.getPrototypeOf(backend);
        const methods = Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor');

        // Look for methods that might generate or use event IDs
        const relevantMethods = methods.filter(m => {
          const lower = m.toLowerCase();
          return lower.includes('event') ||
                 lower.includes('session') ||
                 lower.includes('agent') ||
                 lower.includes('ai') ||
                 lower.includes('track') ||
                 lower.includes('analytics') ||
                 lower.includes('id') ||
                 lower.includes('generate');
        });

        // Get function sources for the relevant methods
        const methodSources = {};
        for (const method of relevantMethods) {
          const fn = backend[method];
          if (fn) {
            methodSources[method] = fn.toString().slice(0, 300);
          }
        }

        return { relevantMethods, methodSources };
      })()
    `,
    returnByValue: true,
  });

  console.log("Backend methods related to events/IDs:");
  console.log(JSON.stringify(backendMethodsResult.result.value, null, 2));

  console.log("\n=== Step 6: Look for ShortId in app bundles ===\n");

  // Search for ShortId class or function in the app's modules
  const shortIdModuleResult = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Look for global exports
        const ga = window.GoogleAccount;

        // Search the DI container more thoroughly
        const di = ga?.di;
        if (di) {
          // Look at the registry
          if (di._registry) {
            results.registryKeys = Object.keys(di._registry).slice(0, 50);
          }

          // Look at providers
          if (di._providers) {
            results.providerKeys = Object.keys(di._providers).slice(0, 50);
          }

          // Look at instances
          if (di._instances) {
            results.instanceKeys = Object.keys(di._instances).slice(0, 50);
          }

          // Try alternative access patterns
          try {
            results.diStructure = {
              keys: Object.keys(di),
              getOwnProps: Object.getOwnPropertyNames(di),
            };
          } catch {}
        }

        // Look in window for any module system
        if (window.__SUPERHUMAN__) {
          results.superhumanKeys = Object.keys(window.__SUPERHUMAN__).slice(0, 20);
        }
        if (window.__modules__) {
          results.modulesKeys = Object.keys(window.__modules__).slice(0, 20);
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("Module/DI structure:");
  console.log(JSON.stringify(shortIdModuleResult.result.value, null, 2));

  console.log("\n=== Step 7: Analyze pseudoTeamId format ===\n");

  const analyzeResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const pseudoTeamId = ga?.accountStore?.state?.account?.settings?._cache?.pseudoTeamId;

        // Known event IDs: event_11VNPcC4sKPDv33Mx5, event_11VNPdc4sKP2pEaKSz
        // Pseudo team ID format: team_XXXXXXXXXX

        const result = {
          pseudoTeamId,
          prefix: pseudoTeamId?.replace('team_', '').substring(0, 5),
          // Check if prefix matches known event ID pattern
          // Event IDs appear to have format: event_ + first 5 chars of teamId suffix + push ID
        };

        // Try to figure out the relationship between teamId and eventId prefix
        if (pseudoTeamId) {
          const teamSuffix = pseudoTeamId.replace('team_', '');
          result.teamSuffix = teamSuffix;
          result.possibleEventPrefix = teamSuffix.substring(0, 5);
        }

        return result;
      })()
    `,
    returnByValue: true,
  });

  console.log("Pseudo Team ID analysis:");
  console.log(JSON.stringify(analyzeResult.result.value, null, 2));

  console.log("\n=== Step 8: Try to call askAI through Superhuman's backend ===\n");

  // Maybe we can just call the backend method directly and it will generate the ID
  const askAIMethodResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const backend = ga?.backend;
        const di = ga?.di;

        const results = {};

        // Look for askAI or similar methods
        if (backend) {
          const proto = Object.getPrototypeOf(backend);
          const methods = Object.getOwnPropertyNames(proto);
          results.backendAIMethods = methods.filter(m =>
            m.toLowerCase().includes('ai') ||
            m.toLowerCase().includes('ask') ||
            m.toLowerCase().includes('chat') ||
            m.toLowerCase().includes('query')
          );

          // Get function source for askAI if exists
          for (const m of results.backendAIMethods) {
            try {
              results['source_' + m] = backend[m]?.toString().slice(0, 500);
            } catch {}
          }
        }

        // Look for an AI service in DI
        const aiServiceNames = ['AIService', 'aiService', 'AI', 'ai', 'AskAI', 'askAi', 'ChatService'];
        for (const name of aiServiceNames) {
          try {
            const svc = di?.get?.(name);
            if (svc) {
              results[name] = {
                type: typeof svc,
                methods: typeof svc === 'object' ? Object.keys(svc) : null,
              };
            }
          } catch {}
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("AI-related methods:");
  console.log(JSON.stringify(askAIMethodResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
