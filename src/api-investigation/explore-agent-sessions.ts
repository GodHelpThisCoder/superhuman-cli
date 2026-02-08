/**
 * Explore the agentSessions service to find event ID generation
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime } = conn;

  console.log("=== Explore agentSessions methods ===\n");

  // Get method sources
  const methodSourcesResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const agentSessions = di?.get?.('agentSessions');

        if (!agentSessions) return { error: 'No agentSessions' };

        const methods = {};
        const proto = Object.getPrototypeOf(agentSessions);

        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name !== 'constructor') {
            try {
              methods[name] = agentSessions[name].toString().slice(0, 500);
            } catch {}
          }
        }

        return methods;
      })()
    `,
    returnByValue: true,
  });

  console.log("Method sources:");
  for (const [name, source] of Object.entries(methodSourcesResult.result.value)) {
    console.log(`\n=== ${name} ===`);
    console.log(source);
  }

  console.log("\n\n=== Try calling startLocalSession ===\n");

  // Try to start a local session and see what ID it generates
  const startSessionResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const agentSessions = di?.get?.('agentSessions');

        if (!agentSessions) return { error: 'No agentSessions' };

        try {
          // Check if startLocalSession takes parameters
          const startFn = agentSessions.startLocalSession;
          const fnStr = startFn?.toString().slice(0, 300);

          // Try to call it with minimal params
          // Looking at the function signature might help
          return {
            fnSignature: fnStr,
            note: 'Will try to call after analyzing signature'
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("startLocalSession info:");
  console.log(JSON.stringify(startSessionResult.result.value, null, 2));

  console.log("\n=== Search for ID generation in window modules ===\n");

  // Look for any webpack/module exports that might have ID generation
  const moduleSearchResult = await Runtime.evaluate({
    expression: `
      (() => {
        const results = [];

        // Search for any global that looks like a module export
        for (const key of Object.keys(window)) {
          const val = window[key];
          if (val && typeof val === 'object') {
            // Look for common module patterns
            if (val.__esModule || val.default || val.exports) {
              const exports = val.default || val.exports || val;
              if (typeof exports === 'object') {
                for (const expKey of Object.keys(exports)) {
                  if (expKey.toLowerCase().includes('id') ||
                      expKey.toLowerCase().includes('short') ||
                      expKey.toLowerCase().includes('unique')) {
                    results.push({ globalKey: key, exportKey: expKey, type: typeof exports[expKey] });
                  }
                }
              }
            }
          }
        }

        return results.slice(0, 20);
      })()
    `,
    returnByValue: true,
  });

  console.log("Module exports with ID patterns:");
  console.log(JSON.stringify(moduleSearchResult.result.value, null, 2));

  console.log("\n=== Look for Push ID pattern in code ===\n");

  // Firebase Push IDs have a specific pattern - look for this in the codebase
  const pushIdResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;

        // Check if there's a Firebase-like push ID generator
        // Push IDs are 20 chars: 8 timestamp chars + 12 random chars
        // They use a specific alphabet: "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz"

        const firebaseChars = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

        // Search backend methods for anything that looks like it generates push IDs
        const backend = ga?.backend;
        const di = ga?.di;

        const results = {};

        // Look for timestamp-based ID generation
        if (backend) {
          const proto = Object.getPrototypeOf(backend);
          for (const method of Object.getOwnPropertyNames(proto)) {
            const fn = backend[method];
            if (typeof fn === 'function') {
              const src = fn.toString();
              if (src.includes('timestamp') || src.includes('Date.now') || src.includes('getTime')) {
                if (src.includes('64') || src.includes('36') || src.includes('charAt')) {
                  results[method] = src.slice(0, 200);
                }
              }
            }
          }
        }

        // Look in DI for ID-related services
        if (di?._registry) {
          for (const key of Object.keys(di._registry)) {
            if (key.toLowerCase().includes('id') ||
                key.toLowerCase().includes('event') ||
                key.toLowerCase().includes('unique')) {
              results['registry_' + key] = 'found';
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("Push ID-like patterns:");
  console.log(JSON.stringify(pushIdResult.result.value, null, 2));

  console.log("\n=== Check blackBox service for event tracking ===\n");

  const blackBoxResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        try {
          const blackBox = di?.get?.('blackBox');
          if (!blackBox) return { error: 'No blackBox service' };

          return {
            type: typeof blackBox,
            keys: Object.keys(blackBox),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(blackBox)).filter(n => n !== 'constructor'),
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("blackBox service:");
  console.log(JSON.stringify(blackBoxResult.result.value, null, 2));

  console.log("\n=== Directly call aiComposeEdit to get a valid session ===\n");

  // Try to see if we can get the app to generate an event ID for us
  const generateIdResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const backend = ga?.backend;

        // Look for any method that creates event IDs
        // The aiComposeEdit method takes questionEventId as a param,
        // so something else must generate it

        // Check if there's a generateEventId or similar helper
        const helpers = {};

        // Search backend for generate* methods
        if (backend) {
          const proto = Object.getPrototypeOf(backend);
          for (const method of Object.getOwnPropertyNames(proto)) {
            if (method.toLowerCase().includes('generate') ||
                method.toLowerCase().includes('create') && method.toLowerCase().includes('id')) {
              helpers[method] = typeof backend[method];
            }
          }
        }

        // Check window for ID generators
        for (const key of ['generateId', 'createId', 'uniqueId', 'shortId', 'pushId', 'eventId', 'uuid']) {
          if (typeof window[key] === 'function') {
            try {
              helpers['window.' + key] = window[key]();
            } catch {}
          }
        }

        return helpers;
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("ID generation helpers:");
  console.log(JSON.stringify(generateIdResult.result.value, null, 2));

  console.log("\n=== Search for the literal 'event_' string in code ===\n");

  // Look for where 'event_' prefix is added
  const eventPrefixResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const results = [];

        function searchForEventPrefix(obj, path, depth = 0) {
          if (depth > 3 || !obj) return;

          for (const key of Object.keys(obj)) {
            try {
              const val = obj[key];
              if (typeof val === 'function') {
                const src = val.toString();
                if (src.includes("'event_'") || src.includes('"event_"') || src.includes('\`event_\`')) {
                  results.push({ path: path + '.' + key, preview: src.slice(0, 300) });
                }
              }
            } catch {}
          }
        }

        searchForEventPrefix(ga, 'ga');
        searchForEventPrefix(ga?.backend, 'backend');
        searchForEventPrefix(window, 'window');

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("Functions containing 'event_' prefix:");
  console.log(JSON.stringify(eventPrefixResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
