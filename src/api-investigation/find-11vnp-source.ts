/**
 * Find where the 11VNP event ID prefix comes from
 *
 * Known:
 * - pseudoTeamId: team_11STeHt1wOE5UlznX9 (prefix: 11STe)
 * - Real event IDs: event_11VNPcC4sKPDv33Mx5 (prefix: 11VNP)
 *
 * The prefixes don't match, so there must be another source for "11VNP"
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime } = conn;

  console.log("=== Search for 11VNP source ===\n");

  // Thorough search for anything containing 11VNP
  const searchResult = await Runtime.evaluate({
    expression: `
      (() => {
        const results = [];
        const searchTerms = ['11VNP', 'VNP'];

        // Search localStorage
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            for (const term of searchTerms) {
              if (value?.includes(term)) {
                results.push({
                  source: 'localStorage',
                  key,
                  match: term,
                  context: value.substring(Math.max(0, value.indexOf(term) - 20), value.indexOf(term) + 50)
                });
              }
            }
          }
        } catch {}

        // Search sessionStorage
        try {
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            const value = sessionStorage.getItem(key);
            for (const term of searchTerms) {
              if (value?.includes(term)) {
                results.push({
                  source: 'sessionStorage',
                  key,
                  match: term,
                  context: value.substring(Math.max(0, value.indexOf(term) - 20), value.indexOf(term) + 50)
                });
              }
            }
          }
        } catch {}

        // Search IndexedDB key names (superficial)
        try {
          if (window.indexedDB) {
            results.push({ source: 'indexedDB', note: 'Cannot search content synchronously' });
          }
        } catch {}

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("Storage search results:");
  console.log(JSON.stringify(searchResult.result.value, null, 2));

  console.log("\n=== Check all user-related IDs ===\n");

  // Get all possible user identifiers
  const userIdsResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const account = ga?.accountStore?.state?.account;
        const user = ga?.accountStore?.state?.user;
        const credential = ga?.credential;
        const authData = credential?._authData;
        const settings = account?.settings?._cache;

        return {
          // Account IDs
          accountId: account?.id,
          accountEmail: account?.emailAddress,
          accountName: account?.name,

          // User IDs
          userId: user?.id,
          userEmail: user?.emailAddress,

          // Auth IDs
          googleId: authData?.googleId,
          userId2: authData?.userId,

          // Settings IDs
          pseudoTeamId: settings?.pseudoTeamId,
          teamId: settings?.teamId,

          // Credential IDs
          credentialUserId: credential?.userId,
          providerId: credential?._providerId,

          // Any other IDs in credential
          credentialKeys: credential ? Object.keys(credential) : null,
          authDataKeys: authData ? Object.keys(authData) : null,
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("All user IDs:");
  console.log(JSON.stringify(userIdsResult.result.value, null, 2));

  console.log("\n=== Search agentSessions in DI ===\n");

  // Look at agentSessions service
  const agentSessionsResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        try {
          const agentSessions = di?.get?.('agentSessions');
          if (!agentSessions) return { error: 'No agentSessions service' };

          return {
            type: typeof agentSessions,
            keys: Object.keys(agentSessions),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(agentSessions)).filter(n => n !== 'constructor'),
            // Try to get any stored session IDs
            state: agentSessions?.state ? Object.keys(agentSessions.state) : null,
            sessions: agentSessions?.sessions ? Object.keys(agentSessions.sessions).slice(0, 5) : null,
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("agentSessions service:");
  console.log(JSON.stringify(agentSessionsResult.result.value, null, 2));

  console.log("\n=== Check profiler/analytics for eventId patterns ===\n");

  // Look at profiler service which might have event tracking
  const profilerResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        try {
          const profiler = di?.get?.('profiler');
          if (!profiler) return { error: 'No profiler service' };

          return {
            type: typeof profiler,
            keys: Object.keys(profiler),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(profiler)).filter(n => n !== 'constructor'),
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("profiler service:");
  console.log(JSON.stringify(profilerResult.result.value, null, 2));

  console.log("\n=== Look at the op service (operations/analytics) ===\n");

  const opResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        try {
          const op = di?.get?.('op');
          if (!op) return { error: 'No op service' };

          return {
            type: typeof op,
            keys: Object.keys(op),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(op)).filter(n => n !== 'constructor'),
            // Check for any ID generation
            generateId: typeof op.generateId === 'function',
            shortId: typeof op.shortId === 'function',
            eventId: typeof op.eventId === 'function',
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("op service:");
  console.log(JSON.stringify(opResult.result.value, null, 2));

  console.log("\n=== Try to find ShortId in minified code ===\n");

  // Search for ShortId patterns in function bodies
  const shortIdPatternResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const results = [];

        // Look for functions that generate IDs
        function searchForIdGen(obj, path, depth = 0) {
          if (depth > 3 || !obj) return;

          for (const key of Object.keys(obj)) {
            try {
              const val = obj[key];
              if (typeof val === 'function') {
                const src = val.toString();
                // Look for patterns like base64, random chars, push ID patterns
                if (src.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') ||
                    src.includes('PUSH_CHARS') ||
                    src.includes('shortid') ||
                    src.includes('nanoid') ||
                    src.includes('cuid') ||
                    src.includes('timestamp')) {
                  results.push({
                    path: path + '.' + key,
                    preview: src.substring(0, 200)
                  });
                }
              }
            } catch {}
          }
        }

        // Search in common places
        searchForIdGen(ga, 'ga');
        searchForIdGen(ga?.backend, 'ga.backend');
        searchForIdGen(ga?.accountStore, 'ga.accountStore');
        searchForIdGen(window, 'window');

        return results.slice(0, 10);
      })()
    `,
    returnByValue: true,
  });

  console.log("Functions with ID generation patterns:");
  console.log(JSON.stringify(shortIdPatternResult.result.value, null, 2));

  console.log("\n=== Intercept fetch for AI calls and extract event IDs ===\n");

  // Install a more comprehensive interceptor
  await Runtime.evaluate({
    expression: `
      (function() {
        if (window._aiCallInterceptorInstalled) return 'Already installed';

        window._aiCallInterceptorInstalled = true;
        window._capturedEventIds = [];
        const originalFetch = window.fetch;

        window.fetch = async function(...args) {
          const [url, options] = args;

          // Check for AI API calls
          if (typeof url === 'string' && (url.includes('ai.') || url.includes('askAI'))) {
            try {
              const body = options?.body;
              if (body && typeof body === 'string') {
                const parsed = JSON.parse(body);
                if (parsed.question_event_id || parsed.session_id) {
                  window._capturedEventIds.push({
                    url,
                    question_event_id: parsed.question_event_id,
                    session_id: parsed.session_id,
                    timestamp: Date.now()
                  });
                  console.log('[AI CALL]', parsed.question_event_id);
                }
              }
            } catch {}
          }

          return originalFetch.apply(this, args);
        };

        return 'Interceptor installed';
      })()
    `,
  });

  console.log("AI call interceptor installed. Use Ask AI in Superhuman to capture real event IDs.");

  console.log("\n=== Check for provider-specific ID prefixes ===\n");

  // The prefix might come from the provider (Google/Microsoft)
  const providerResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        try {
          const provider = di?.get?.('provider');
          const isMicrosoft = di?.get?.('isMicrosoft');

          return {
            providerType: typeof provider,
            providerKeys: provider ? Object.keys(provider) : null,
            isMicrosoft,
            // Check if provider has any ID generation
            providerIdMethod: typeof provider?.generateId,
            providerShortId: typeof provider?.shortId,
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("Provider info:");
  console.log(JSON.stringify(providerResult.result.value, null, 2));

  console.log("\n=== Check disk service for stored event IDs ===\n");

  const diskResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        try {
          const disk = di?.get?.('disk');
          if (!disk) return { error: 'No disk service' };

          return {
            type: typeof disk,
            keys: Object.keys(disk),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(disk)).filter(n => n !== 'constructor').slice(0, 30),
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("disk service:");
  console.log(JSON.stringify(diskResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
