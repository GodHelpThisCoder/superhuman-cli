/**
 * Analyze the event ID pattern from captured sessions
 *
 * Known event IDs:
 * event_11VNPF94sKPO6AMXRZ
 * event_11VNPEM4sKPzY6CQsu
 * event_11VNPth4sKPNc6w5fa
 * event_11VNPtz4sKP2MhVstC
 * event_11VNPcC4sKPDv33Mx5
 * event_11VNPdc4sKP2pEaKSz
 * event_11VNPdm4sKPJgnGngq
 * event_11VNPqI4sKPrTHpydN
 * event_11VNPr84sKPMrNvUoG
 *
 * Pattern analysis:
 * - event_ prefix (6 chars)
 * - 11VNP (5 chars) - static prefix for this user
 * - 2 chars that vary
 * - 4sKP (4 chars) - appears consistent! This is suspicious
 * - 8-9 more chars that vary
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime } = conn;

  console.log("=== Extract all event IDs from sessions ===\n");

  const eventIdsResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const portal = di?.get?.('portal');

        const sessions = await portal.invoke('agentSessionsInternal', 'getAllSessions', []);
        const eventIds = [];

        for (const session of sessions) {
          try {
            const json = JSON.parse(session.json);
            if (json.events) {
              for (const event of json.events) {
                if (event.payload?.event_id) {
                  eventIds.push(event.payload.event_id);
                }
              }
            }
          } catch {}
        }

        return {
          total: eventIds.length,
          unique: [...new Set(eventIds)],
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("All event IDs:");
  const { unique } = eventIdsResult.result.value;
  console.log(unique.join('\n'));

  console.log("\n=== Analyze event ID pattern ===\n");

  // Analyze the pattern
  const ids = unique.filter((id: string) => id.startsWith('event_'));

  if (ids.length > 0) {
    // Remove prefix
    const suffixes = ids.map((id: string) => id.replace('event_', ''));

    console.log("Suffixes (without event_ prefix):");
    suffixes.forEach((s: string) => console.log(`  ${s} (length: ${s.length})`));

    // Check for common substring
    console.log("\n\nLooking for patterns...");

    // Character frequency at each position
    const positions: { [key: number]: { [char: string]: number } } = {};

    for (const suffix of suffixes) {
      for (let i = 0; i < suffix.length; i++) {
        if (!positions[i]) positions[i] = {};
        positions[i][suffix[i]] = (positions[i][suffix[i]] || 0) + 1;
      }
    }

    console.log("\nCharacter frequency by position:");
    for (let i = 0; i < 19; i++) {
      if (positions[i]) {
        const chars = Object.entries(positions[i])
          .sort((a, b) => b[1] - a[1])
          .map(([char, count]) => `${char}:${count}`)
          .join(', ');
        console.log(`  Position ${i.toString().padStart(2)}: ${chars}`);
      }
    }

    // Find the fixed prefix
    let commonPrefix = '';
    for (let i = 0; i < suffixes[0].length; i++) {
      const char = suffixes[0][i];
      if (suffixes.every((s: string) => s[i] === char)) {
        commonPrefix += char;
      } else {
        break;
      }
    }
    console.log(`\nCommon prefix: "${commonPrefix}" (length: ${commonPrefix.length})`);
  }

  console.log("\n=== Check pseudoTeamId relationship ===\n");

  const teamIdResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const pseudoTeamId = ga?.accountStore?.state?.account?.settings?._cache?.pseudoTeamId;
        const googleId = ga?.credential?._authData?.googleId;

        return {
          pseudoTeamId,
          teamSuffix: pseudoTeamId?.replace('team_', ''),
          googleId,
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("Team/User IDs:");
  console.log(JSON.stringify(teamIdResult.result.value, null, 2));

  console.log("\n=== Generate test IDs using different approaches ===\n");

  // Try to understand the ID generation
  // Firebase Push IDs use: timestamp (8 chars) + random (12 chars) = 20 chars
  // But our IDs are 17 chars after event_ prefix

  // Try to decode the timestamp portion
  const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

  console.log("Firebase Push ID charset (64 chars):");
  console.log(PUSH_CHARS);
  console.log(`Length: ${PUSH_CHARS.length}`);

  // Check if our event IDs use this charset
  const testId = unique[0]?.replace('event_', '') || '';
  console.log(`\nTest ID: ${testId}`);
  console.log("Chars in Push charset:", [...testId].every(c => PUSH_CHARS.includes(c)));

  // Try another charset - base62
  const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  console.log("Chars in Base62 charset:", [...testId].every(c => BASE62.includes(c)));

  console.log("\n=== Try to find the ShortId class source ===\n");

  // Search for the minified ShortId class
  const shortIdSourceResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;

        // Search all functions for the ID generation pattern
        const found = [];

        function searchFunctions(obj, path, depth = 0) {
          if (depth > 3 || !obj) return;

          for (const key of Object.keys(obj)) {
            try {
              const val = obj[key];
              if (typeof val === 'function') {
                const src = val.toString();
                // Look for base62/64 charset patterns
                if (src.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') ||
                    src.includes('-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz')) {
                  found.push({ path: path + '.' + key, src: src.slice(0, 500) });
                }
              }
            } catch {}
          }
        }

        searchFunctions(ga, 'ga');
        searchFunctions(ga?.backend, 'backend');
        searchFunctions(ga?.di, 'di');

        // Also search window
        for (const key of Object.keys(window)) {
          try {
            const val = window[key];
            if (typeof val === 'function') {
              const src = val.toString();
              if (src.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') ||
                  src.includes('-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz')) {
                found.push({ path: 'window.' + key, src: src.slice(0, 500) });
              }
            }
          } catch {}
        }

        return found;
      })()
    `,
    returnByValue: true,
  });

  console.log("Functions with charset patterns:");
  console.log(JSON.stringify(shortIdSourceResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
