/**
 * Find the shortId generator source code in Superhuman
 */

import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  console.log("=== Finding shortId Generator ===\n");

  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  const { Runtime, client } = conn;

  // Search for shortId function in scripts
  console.log("1. Looking for shortId function definition...\n");

  const searchResult = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Check if there's a shortId anywhere on window
        function searchForShortId(obj, path, depth = 0) {
          if (depth > 3 || !obj || typeof obj !== 'object') return;

          try {
            for (const [key, value] of Object.entries(obj)) {
              if (key === 'shortId' || key === 'generateId' || key === 'createId') {
                results[path + '.' + key] = {
                  type: typeof value,
                  source: typeof value === 'function' ? value.toString().slice(0, 200) : 'not a function'
                };
              }
              if (typeof value === 'object' && value !== null) {
                searchForShortId(value, path + '.' + key, depth + 1);
              }
            }
          } catch {}
        }

        // Search in GoogleAccount
        if (window.GoogleAccount) {
          searchForShortId(window.GoogleAccount, 'GoogleAccount');
        }

        // Search in ViewState
        if (window.ViewState) {
          searchForShortId(window.ViewState, 'ViewState');
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("shortId search:", JSON.stringify(searchResult.result.value, null, 2));

  // Try to find the source by looking at all scripts
  console.log("\n2. Searching script sources...\n");

  // Get all loaded scripts
  await client.Debugger.enable();

  const scripts: any[] = [];
  client.Debugger.scriptParsed((params: any) => {
    if (params.url.includes("superhuman")) {
      scripts.push({ url: params.url, scriptId: params.scriptId });
    }
  });

  // Wait for script events
  await new Promise(r => setTimeout(r, 1000));

  console.log(`Found ${scripts.length} Superhuman scripts`);

  // Search for shortId in main bundle
  const mainScript = scripts.find(s => s.url.includes("main") || s.url.includes("bundle"));

  if (mainScript) {
    console.log(`\nSearching in: ${mainScript.url}\n`);

    const source = await client.Debugger.getScriptSource({ scriptId: mainScript.scriptId });
    const sourceText = source.scriptSource;

    // Look for shortId pattern
    const shortIdMatch = sourceText.match(/shortId\s*[:=]\s*function[^}]+\}/);
    if (shortIdMatch) {
      console.log("Found shortId function:\n", shortIdMatch[0].slice(0, 500));
    }

    // Look for event_ pattern
    const eventPatternMatch = sourceText.match(/["']event_["'].*?[+,;]/);
    if (eventPatternMatch) {
      console.log("\nFound event_ pattern:\n", eventPatternMatch[0]);
    }

    // Look for any ID generation pattern near "event_"
    const eventIdx = sourceText.indexOf('"event_"');
    if (eventIdx > -1) {
      const context = sourceText.slice(Math.max(0, eventIdx - 200), eventIdx + 200);
      console.log("\nContext around 'event_':\n", context);
    }
  }

  // Inspect prototype chain for ID generation
  console.log("\n3. Checking module exports...\n");

  const moduleCheck = await Runtime.evaluate({
    expression: `
      (() => {
        const results = {};

        // Check __webpack_modules__ if it exists
        if (window.__webpack_modules__) {
          results.hasWebpackModules = true;
          const moduleKeys = Object.keys(window.__webpack_modules__);
          results.moduleCount = moduleKeys.length;

          // Search for modules containing shortId
          for (const key of moduleKeys.slice(0, 100)) {
            try {
              const mod = window.__webpack_modules__[key];
              if (mod && mod.toString().includes('shortId')) {
                results.shortIdModules = results.shortIdModules || [];
                results.shortIdModules.push(key);
              }
            } catch {}
          }
        }

        // Check if there's a require function
        if (window.require) {
          results.hasRequire = true;
        }

        // Look for cuid or nanoid
        try {
          if (window.cuid) results.hasCuid = true;
        } catch {}

        try {
          if (window.nanoid) results.hasNanoid = true;
        } catch {}

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("Module check:", JSON.stringify(moduleCheck.result.value, null, 2));

  // Generate an ID using the same pattern as Superhuman
  console.log("\n4. Analyzing team ID pattern...\n");

  const patternAnalysis = await Runtime.evaluate({
    expression: `
      (() => {
        const teamId = "team_11STeHt1wOE5UlznX9";
        const suffix = teamId.replace("team_", "");

        // Analyze the character composition
        const analysis = {
          teamId,
          suffix,
          suffixLength: suffix.length,
          hasUppercase: /[A-Z]/.test(suffix),
          hasLowercase: /[a-z]/.test(suffix),
          hasDigits: /[0-9]/.test(suffix),
          startsWithDigits: /^[0-9]+/.test(suffix),
          digitPrefix: suffix.match(/^[0-9]+/)?.[0] || '',
          restAfterDigits: suffix.replace(/^[0-9]+/, ''),
          charCodes: [...suffix].map(c => c.charCodeAt(0))
        };

        // Check if it looks like base62 encoding
        const base62Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        const isBase62 = [...suffix].every(c => base62Chars.includes(c));
        analysis.isBase62Compatible = isBase62;

        // Try to decode if it's a base62 number
        if (isBase62) {
          try {
            let num = 0n;
            for (const c of suffix) {
              num = num * 62n + BigInt(base62Chars.indexOf(c));
            }
            analysis.base62Decoded = num.toString();
          } catch {}
        }

        return analysis;
      })()
    `,
    returnByValue: true
  });

  console.log("Pattern analysis:", JSON.stringify(patternAnalysis.result.value, null, 2));

  await client.Debugger.disable().catch(() => {});
  await disconnect(conn);
}

main().catch(console.error);
