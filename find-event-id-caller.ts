/**
 * Find where questionEventId is generated in Superhuman
 */

import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  console.log("=== Finding Event ID Generator ===\n");

  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    process.exit(1);
  }

  const { Runtime, client } = conn;

  // Search webpack chunks more thoroughly
  console.log("1. Deep searching webpack modules...\n");

  const deepSearch = await Runtime.evaluate({
    expression: `
      (() => {
        const results = { found: [], eventIdGenerators: [] };

        // Search all webpack modules
        if (window.webpackChunk_superhuman_desktop_webapp) {
          for (const chunk of window.webpackChunk_superhuman_desktop_webapp) {
            if (Array.isArray(chunk) && chunk[1]) {
              for (const [moduleId, moduleFunc] of Object.entries(chunk[1])) {
                try {
                  const funcStr = moduleFunc.toString();

                  // Look for questionEventId generation
                  if (funcStr.includes('questionEventId')) {
                    const idx = funcStr.indexOf('questionEventId');
                    const context = funcStr.substring(
                      Math.max(0, idx - 100),
                      Math.min(funcStr.length, idx + 200)
                    );
                    results.found.push({
                      moduleId,
                      context
                    });
                  }

                  // Look for shortId usage
                  if (funcStr.includes('shortId')) {
                    const idx = funcStr.indexOf('shortId');
                    const context = funcStr.substring(
                      Math.max(0, idx - 50),
                      Math.min(funcStr.length, idx + 150)
                    );
                    results.eventIdGenerators.push({
                      moduleId,
                      type: 'shortId',
                      context
                    });
                  }

                  // Look for event ID assignment
                  if (funcStr.includes('event_id=') || funcStr.includes('event_id:') ||
                      funcStr.includes('eventId=') || funcStr.includes('eventId:')) {
                    const patterns = [
                      /event_id\s*[=:]\s*[^,;\n]+/g,
                      /eventId\s*[=:]\s*[^,;\n]+/g
                    ];
                    for (const pattern of patterns) {
                      const matches = funcStr.match(pattern);
                      if (matches) {
                        results.eventIdGenerators.push({
                          moduleId,
                          type: 'assignment',
                          matches: matches.slice(0, 3)
                        });
                      }
                    }
                  }
                } catch {}
              }
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("Deep search results:");
  console.log("  Found questionEventId references:", deepSearch.result.value.found.length);
  for (const f of (deepSearch.result.value.found || []).slice(0, 5)) {
    console.log(`\n  Module ${f.moduleId}:`);
    console.log(`    ${f.context.replace(/\n/g, ' ')}`);
  }

  console.log("\n  Event ID generators:", deepSearch.result.value.eventIdGenerators.length);
  for (const g of (deepSearch.result.value.eventIdGenerators || []).slice(0, 5)) {
    console.log(`\n  Module ${g.moduleId} (${g.type}):`);
    console.log(`    ${JSON.stringify(g.matches || g.context).substring(0, 200)}`);
  }

  // Look specifically for shortId definition
  console.log("\n\n2. Searching for shortId function definition...\n");

  const shortIdDef = await Runtime.evaluate({
    expression: `
      (() => {
        const results = [];

        if (window.webpackChunk_superhuman_desktop_webapp) {
          for (const chunk of window.webpackChunk_superhuman_desktop_webapp) {
            if (Array.isArray(chunk) && chunk[1]) {
              for (const [moduleId, moduleFunc] of Object.entries(chunk[1])) {
                try {
                  const funcStr = moduleFunc.toString();

                  // Look for shortId function definition patterns
                  const patterns = [
                    /function\s+shortId/,
                    /shortId\s*=\s*function/,
                    /shortId\s*=\s*\([^)]*\)\s*=>/,
                    /const\s+shortId\s*=/,
                    /let\s+shortId\s*=/,
                    /var\s+shortId\s*=/,
                    /exports\.shortId\s*=/
                  ];

                  for (const pattern of patterns) {
                    if (pattern.test(funcStr)) {
                      const match = funcStr.match(pattern);
                      if (match) {
                        const idx = match.index;
                        const context = funcStr.substring(idx, Math.min(funcStr.length, idx + 300));
                        results.push({
                          moduleId,
                          pattern: pattern.toString(),
                          context
                        });
                      }
                    }
                  }
                } catch {}
              }
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("shortId definitions found:", shortIdDef.result.value.length);
  for (const def of (shortIdDef.result.value || []).slice(0, 10)) {
    console.log(`\nModule ${def.moduleId}:`);
    console.log(`  Pattern: ${def.pattern}`);
    console.log(`  Context: ${def.context.substring(0, 200).replace(/\n/g, ' ')}`);
  }

  // Look for the askAI proxy call site
  console.log("\n\n3. Finding askAIProxy call site...\n");

  const askAICallSite = await Runtime.evaluate({
    expression: `
      (() => {
        const results = [];

        if (window.webpackChunk_superhuman_desktop_webapp) {
          for (const chunk of window.webpackChunk_superhuman_desktop_webapp) {
            if (Array.isArray(chunk) && chunk[1]) {
              for (const [moduleId, moduleFunc] of Object.entries(chunk[1])) {
                try {
                  const funcStr = moduleFunc.toString();

                  if (funcStr.includes('askAIProxy') || funcStr.includes('ai.askAIProxy')) {
                    const idx = funcStr.indexOf('askAIProxy');
                    const context = funcStr.substring(
                      Math.max(0, idx - 200),
                      Math.min(funcStr.length, idx + 400)
                    );
                    results.push({
                      moduleId,
                      context
                    });
                  }
                } catch {}
              }
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("askAIProxy call sites found:", askAICallSite.result.value.length);
  for (const site of (askAICallSite.result.value || []).slice(0, 5)) {
    console.log(`\nModule ${site.moduleId}:`);
    console.log(`  ${site.context.replace(/\n/g, ' ').substring(0, 500)}`);
  }

  // Check if shortId is being called with specific parameters
  console.log("\n\n4. Analyzing shortId usage patterns...\n");

  const shortIdUsage = await Runtime.evaluate({
    expression: `
      (() => {
        const results = [];

        if (window.webpackChunk_superhuman_desktop_webapp) {
          for (const chunk of window.webpackChunk_superhuman_desktop_webapp) {
            if (Array.isArray(chunk) && chunk[1]) {
              for (const [moduleId, moduleFunc] of Object.entries(chunk[1])) {
                try {
                  const funcStr = moduleFunc.toString();

                  // Look for shortId being called
                  const callPatterns = [
                    /shortId\s*\(\s*["'][^"']*["']\s*\)/g,  // shortId("prefix")
                    /shortId\s*\(\s*\)/g,                    // shortId()
                    /shortId\s*\(\s*\d+\s*\)/g,              // shortId(17)
                  ];

                  for (const pattern of callPatterns) {
                    const matches = funcStr.match(pattern);
                    if (matches) {
                      results.push({
                        moduleId,
                        calls: matches.slice(0, 5)
                      });
                    }
                  }
                } catch {}
              }
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true
  });

  console.log("shortId usage found:", shortIdUsage.result.value.length);
  for (const usage of (shortIdUsage.result.value || []).slice(0, 10)) {
    console.log(`\nModule ${usage.moduleId}:`);
    console.log(`  Calls: ${JSON.stringify(usage.calls)}`);
  }

  await disconnect(conn);
}

main().catch(console.error);
