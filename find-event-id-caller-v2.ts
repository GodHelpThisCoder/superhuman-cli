/**
 * Find where questionEventId is generated in Superhuman (v2 - with better error handling)
 */

import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  console.log("=== Finding Event ID Generator v2 ===\n");

  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  // First, check if webpack chunks exist
  console.log("1. Checking webpack chunks...\n");

  const checkChunks = await Runtime.evaluate({
    expression: `
      (() => {
        const chunks = window.webpackChunk_superhuman_desktop_webapp;
        if (!chunks) return { error: 'No webpack chunks found' };
        return {
          chunkCount: chunks.length,
          sampleChunk: chunks[0] ? {
            isArray: Array.isArray(chunks[0]),
            hasModules: !!chunks[0][1],
            moduleCount: chunks[0][1] ? Object.keys(chunks[0][1]).length : 0
          } : null
        };
      })()
    `,
    returnByValue: true
  });

  console.log("Chunk info:", JSON.stringify(checkChunks.result?.value, null, 2));

  // Search for shortId in a simpler way
  console.log("\n2. Searching for shortId in modules...\n");

  const shortIdSearch = await Runtime.evaluate({
    expression: `
      (() => {
        const chunks = window.webpackChunk_superhuman_desktop_webapp;
        if (!chunks) return [];

        const results = [];
        let moduleCount = 0;

        for (const chunk of chunks) {
          if (!Array.isArray(chunk) || !chunk[1]) continue;

          for (const [moduleId, moduleFunc] of Object.entries(chunk[1])) {
            moduleCount++;
            if (moduleCount > 500) break; // Limit search

            try {
              const funcStr = String(moduleFunc);
              if (funcStr.includes('shortId')) {
                // Get context around shortId
                const idx = funcStr.indexOf('shortId');
                const context = funcStr.substring(
                  Math.max(0, idx - 50),
                  Math.min(funcStr.length, idx + 200)
                );
                results.push({ moduleId, context: context.substring(0, 250) });
              }
            } catch {}
          }
        }

        return { searched: moduleCount, results };
      })()
    `,
    returnByValue: true,
    timeout: 30000
  });

  const shortIdResult = shortIdSearch.result?.value;
  if (shortIdResult) {
    console.log(`Searched ${shortIdResult.searched} modules`);
    console.log(`Found ${shortIdResult.results?.length || 0} with shortId`);

    for (const r of (shortIdResult.results || []).slice(0, 5)) {
      console.log(`\nModule ${r.moduleId}:`);
      console.log(`  ${r.context.replace(/\n/g, ' ')}`);
    }
  }

  // Look for event_ prefix usage
  console.log("\n\n3. Searching for 'event_' prefix...\n");

  const eventPrefixSearch = await Runtime.evaluate({
    expression: `
      (() => {
        const chunks = window.webpackChunk_superhuman_desktop_webapp;
        if (!chunks) return [];

        const results = [];
        let moduleCount = 0;

        for (const chunk of chunks) {
          if (!Array.isArray(chunk) || !chunk[1]) continue;

          for (const [moduleId, moduleFunc] of Object.entries(chunk[1])) {
            moduleCount++;
            if (moduleCount > 500) break;

            try {
              const funcStr = String(moduleFunc);
              // Look for "event_" or 'event_' strings
              if (funcStr.includes('"event_"') || funcStr.includes("'event_'")) {
                const pattern = /"event_"|'event_'/;
                const match = funcStr.match(pattern);
                if (match) {
                  const idx = match.index;
                  const context = funcStr.substring(
                    Math.max(0, idx - 100),
                    Math.min(funcStr.length, idx + 200)
                  );
                  results.push({ moduleId, context: context.substring(0, 300) });
                }
              }
            } catch {}
          }
        }

        return { searched: moduleCount, results };
      })()
    `,
    returnByValue: true,
    timeout: 30000
  });

  const eventResult = eventPrefixSearch.result?.value;
  if (eventResult) {
    console.log(`Searched ${eventResult.searched} modules`);
    console.log(`Found ${eventResult.results?.length || 0} with 'event_'`);

    for (const r of (eventResult.results || []).slice(0, 5)) {
      console.log(`\nModule ${r.moduleId}:`);
      console.log(`  ${r.context.replace(/\n/g, ' ')}`);
    }
  }

  // Look for question_event_id in request payloads
  console.log("\n\n4. Searching for question_event_id...\n");

  const questionEventSearch = await Runtime.evaluate({
    expression: `
      (() => {
        const chunks = window.webpackChunk_superhuman_desktop_webapp;
        if (!chunks) return [];

        const results = [];
        let moduleCount = 0;

        for (const chunk of chunks) {
          if (!Array.isArray(chunk) || !chunk[1]) continue;

          for (const [moduleId, moduleFunc] of Object.entries(chunk[1])) {
            moduleCount++;
            if (moduleCount > 500) break;

            try {
              const funcStr = String(moduleFunc);
              if (funcStr.includes('question_event_id')) {
                const idx = funcStr.indexOf('question_event_id');
                const context = funcStr.substring(
                  Math.max(0, idx - 100),
                  Math.min(funcStr.length, idx + 200)
                );
                results.push({ moduleId, context: context.substring(0, 300) });
              }
            } catch {}
          }
        }

        return { searched: moduleCount, results };
      })()
    `,
    returnByValue: true,
    timeout: 30000
  });

  const questionResult = questionEventSearch.result?.value;
  if (questionResult) {
    console.log(`Searched ${questionResult.searched} modules`);
    console.log(`Found ${questionResult.results?.length || 0} with question_event_id`);

    for (const r of (questionResult.results || []).slice(0, 5)) {
      console.log(`\nModule ${r.moduleId}:`);
      console.log(`  ${r.context.replace(/\n/g, ' ')}`);
    }
  }

  // Try to find the actual shortId implementation
  console.log("\n\n5. Looking for ID generation function...\n");

  const idGenSearch = await Runtime.evaluate({
    expression: `
      (() => {
        const chunks = window.webpackChunk_superhuman_desktop_webapp;
        if (!chunks) return null;

        // Look for common ID generation patterns
        const patterns = [
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
          'Math.random().toString(36)',
          'nanoid',
          'cuid'
        ];

        for (const chunk of chunks) {
          if (!Array.isArray(chunk) || !chunk[1]) continue;

          for (const [moduleId, moduleFunc] of Object.entries(chunk[1])) {
            try {
              const funcStr = String(moduleFunc);

              for (const pattern of patterns) {
                if (funcStr.includes(pattern)) {
                  const idx = funcStr.indexOf(pattern);
                  const context = funcStr.substring(
                    Math.max(0, idx - 100),
                    Math.min(funcStr.length, idx + 300)
                  );

                  // Check if this looks like an ID generator
                  if (context.includes('return') &&
                      (context.includes('id') || context.includes('Id') || context.includes('ID'))) {
                    return {
                      pattern,
                      moduleId,
                      context: context.substring(0, 400)
                    };
                  }
                }
              }
            } catch {}
          }
        }

        return null;
      })()
    `,
    returnByValue: true,
    timeout: 30000
  });

  console.log("ID generation function:", JSON.stringify(idGenSearch.result?.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
