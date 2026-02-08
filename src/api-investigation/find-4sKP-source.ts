/**
 * Find the source of the "4sKP" user identifier in event IDs
 *
 * Pattern discovered:
 * - event_ prefix
 * - 11V (3 chars) - appears to be version/format identifier
 * - XXX (3 chars) - timestamp high bits?
 * - X (1 char) - varies
 * - 4sKP (4 chars) - CONSTANT user identifier
 * - XXXXXXXX (8 chars) - random/timestamp suffix
 *
 * Total: event_ + 18 chars = 24 chars
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime } = conn;

  console.log("=== Search for 4sKP or sKP in app state ===\n");

  // Search for the user identifier
  const searchResult = await Runtime.evaluate({
    expression: `
      (() => {
        const results = [];
        const searchTerms = ['4sKP', 'sKP'];

        // Deep search function
        function searchObject(obj, path, depth = 0, seen = new WeakSet()) {
          if (depth > 6 || !obj || typeof obj !== 'object') return;
          if (seen.has(obj)) return;
          seen.add(obj);

          try {
            for (const [key, value] of Object.entries(obj)) {
              if (typeof value === 'string') {
                for (const term of searchTerms) {
                  if (value.includes(term)) {
                    results.push({
                      path: path + '.' + key,
                      term,
                      context: value.substring(0, 100)
                    });
                  }
                }
              } else if (typeof value === 'object' && value !== null) {
                searchObject(value, path + '.' + key, depth + 1, seen);
              }
            }
          } catch {}
        }

        const ga = window.GoogleAccount;
        searchObject(ga, 'ga');

        // Also check localStorage
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            for (const term of searchTerms) {
              if (value?.includes(term) && !value.includes('event_')) {
                results.push({
                  source: 'localStorage',
                  key,
                  term,
                  context: value.substring(0, 200)
                });
              }
            }
          }
        } catch {}

        return results.slice(0, 20);
      })()
    `,
    returnByValue: true,
  });

  console.log("Search results for 4sKP/sKP:");
  console.log(JSON.stringify(searchResult.result.value, null, 2));

  console.log("\n=== Check ShortId service directly ===\n");

  // Try to find ShortId in the DI or as a module
  const shortIdResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        // Try to get ShortId or similar from the registry
        const registry = di?._registry;
        const cache = di?._cache;

        const results = {
          registryHasShortId: registry && 'shortId' in registry,
          cacheHasShortId: cache && 'shortId' in cache,
        };

        // Check if there's a shortId in the cache
        if (cache) {
          for (const [key, value] of Object.entries(cache)) {
            if (key.toLowerCase().includes('short') ||
                key.toLowerCase().includes('id') ||
                key.toLowerCase().includes('event')) {
              results['cache_' + key] = typeof value;
            }
          }
        }

        // Look for any object with a userPrefix or similar
        if (ga) {
          for (const [key, value] of Object.entries(ga)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              for (const [innerKey, innerValue] of Object.entries(value)) {
                if ((innerKey.includes('prefix') || innerKey.includes('Prefix')) &&
                    typeof innerValue === 'string') {
                  results['ga.' + key + '.' + innerKey] = innerValue;
                }
              }
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("ShortId search in DI:");
  console.log(JSON.stringify(shortIdResult.result.value, null, 2));

  console.log("\n=== Check blackBox service for _prefix ===\n");

  // blackBox has a _prefix property
  const blackBoxResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const blackBox = di?.get?.('blackBox');

        return {
          prefix: blackBox?._prefix,
          keys: blackBox ? Object.keys(blackBox) : null,
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("blackBox prefix:");
  console.log(JSON.stringify(blackBoxResult.result.value, null, 2));

  console.log("\n=== Try to analyze the ID generation algorithm ===\n");

  // Based on the pattern, let's try to reverse engineer it
  // The IDs look like Firebase Push IDs with a custom prefix

  const analyzeResult = await Runtime.evaluate({
    expression: `
      (() => {
        // Firebase Push ID uses:
        // - 8 chars for timestamp (ms since epoch, base64)
        // - 12 chars for random
        // Total: 20 chars

        // Our IDs are 18 chars with a different structure:
        // - Position 0-2: "11V" - format/version?
        // - Position 3-6: varies (timestamp high bits?)
        // - Position 7: varies
        // - Position 8-10: "4sKP" - user prefix (but this is at position 7-10 in reality)

        // Wait, let me re-analyze:
        // 11VNPF94sKPO6AMXRZ
        // 0123456789...

        // Position 7 is "4", Position 8-10 is "sKP"
        // So "4sKP" spans positions 7-10

        const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

        // Try to decode "11V" as timestamp
        function decodeBase64Timestamp(str) {
          let timestamp = 0;
          for (let i = 0; i < str.length; i++) {
            const idx = PUSH_CHARS.indexOf(str[i]);
            timestamp = timestamp * 64 + idx;
          }
          return timestamp;
        }

        // Try different portions
        const testId = '11VNPF94sKPO6AMXRZ';
        const results = {
          full: testId,
          decode_0_3: decodeBase64Timestamp(testId.substring(0, 3)),
          decode_0_4: decodeBase64Timestamp(testId.substring(0, 4)),
          decode_0_5: decodeBase64Timestamp(testId.substring(0, 5)),
          decode_0_6: decodeBase64Timestamp(testId.substring(0, 6)),
          decode_0_7: decodeBase64Timestamp(testId.substring(0, 7)),
          decode_0_8: decodeBase64Timestamp(testId.substring(0, 8)),
        };

        // Also try as date
        results.asDate_0_8 = new Date(results.decode_0_8).toISOString();

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("Timestamp analysis:");
  console.log(JSON.stringify(analyzeResult.result.value, null, 2));

  console.log("\n=== Get credential details that might contain the user prefix ===\n");

  const credentialResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const credential = ga?.credential;

        if (!credential) return { error: 'No credential' };

        const results = {};

        // Get all properties
        for (const key of Object.keys(credential)) {
          const value = credential[key];
          if (typeof value === 'string' && value.length < 100) {
            results[key] = value;
          } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            for (const innerKey of Object.keys(value)) {
              const innerValue = value[innerKey];
              if (typeof innerValue === 'string' && innerValue.length < 100) {
                results[key + '.' + innerKey] = innerValue;
              }
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log("Credential details:");
  console.log(JSON.stringify(credentialResult.result.value, null, 2));

  console.log("\n=== Look for ShortId in the bundled code ===\n");

  // Try to find the ShortId class constructor
  const bundleSearchResult = await Runtime.evaluate({
    expression: `
      (() => {
        // Search all window properties for classes/functions named ShortId
        const results = [];

        for (const key of Object.getOwnPropertyNames(window)) {
          try {
            const val = window[key];
            if (typeof val === 'function') {
              const name = val.name;
              if (name && (name.toLowerCase().includes('shortid') ||
                          name.toLowerCase().includes('pushid') ||
                          name.toLowerCase().includes('eventid') ||
                          name === 'a' || name === 'e' || name === 'r')) {
                const src = val.toString().slice(0, 200);
                if (src.includes('prefix') || src.includes('Prefix') ||
                    src.includes('timestamp') || src.includes('random')) {
                  results.push({ key, name, preview: src });
                }
              }
            }
          } catch {}
        }

        return results.slice(0, 10);
      })()
    `,
    returnByValue: true,
  });

  console.log("Bundle search for ShortId:");
  console.log(JSON.stringify(bundleSearchResult.result.value, null, 2));

  console.log("\n=== Try to call ShortId.generate() through DI ===\n");

  // Maybe we can access it through the DI container
  const generateIdResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        // Try all possible ways to get ShortId
        const attempts = {};

        // Try direct get with different names
        const names = [
          'ShortId', 'shortId', 'SHORT_ID', 'shortid',
          'EventId', 'eventId', 'event_id',
          'IdGenerator', 'idGenerator', 'id_generator',
          'UniqueId', 'uniqueId', 'unique_id',
          'PushId', 'pushId', 'push_id',
        ];

        for (const name of names) {
          try {
            const svc = di?.get?.(name);
            if (svc) {
              attempts[name] = {
                type: typeof svc,
                keys: typeof svc === 'object' ? Object.keys(svc) : null,
              };

              // Try to call generate methods
              if (typeof svc === 'function') {
                try { attempts[name + '_call'] = svc(); } catch (e) { attempts[name + '_call_err'] = e.message; }
              } else if (typeof svc === 'object') {
                if (typeof svc.generate === 'function') {
                  try { attempts[name + '_generate'] = svc.generate(); } catch (e) { attempts[name + '_generate_err'] = e.message; }
                }
                if (typeof svc.next === 'function') {
                  try { attempts[name + '_next'] = svc.next(); } catch (e) { attempts[name + '_next_err'] = e.message; }
                }
              }
            }
          } catch {}
        }

        return attempts;
      })()
    `,
    returnByValue: true,
  });

  console.log("ID generation attempts:");
  console.log(JSON.stringify(generateIdResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
