/**
 * Extract the ShortId prefix from the userId and implement ID generation
 *
 * Discovered:
 * - userId: user_11SzDPi4sKPTbHQRMQ
 * - event IDs: event_11VNPcC4sKPDv33Mx5
 *
 * Both have "4sKP" at positions 7-10 of the suffix
 *
 * The ID format appears to be:
 * - First 7 chars: timestamp/version (changes)
 * - Position 7-10: "4sKP" user fingerprint (constant)
 * - Remaining 8 chars: random
 *
 * Total: 18 chars after prefix
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

// Firebase Push ID charset
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

// Encode a number to base64 Push ID format
function encodeBase64(num: number, len: number): string {
  let result = '';
  for (let i = len - 1; i >= 0; i--) {
    result = PUSH_CHARS.charAt(num % 64) + result;
    num = Math.floor(num / 64);
  }
  return result;
}

// Generate a random string of given length using Push ID charset
function randomChars(len: number): string {
  let result = '';
  for (let i = 0; i < len; i++) {
    result += PUSH_CHARS.charAt(Math.floor(Math.random() * 64));
  }
  return result;
}

// Generate an event ID with the user's prefix
function generateEventId(userPrefix: string): string {
  // Based on pattern analysis:
  // - 7 chars: timestamp encoded in base64
  // - 4 chars: user prefix (like "4sKP")
  // - 7 chars: random

  const timestamp = Date.now();
  const timestampChars = encodeBase64(timestamp, 7);
  const randomSuffix = randomChars(7);

  return `event_${timestampChars}${userPrefix}${randomSuffix}`;
}

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime } = conn;

  console.log("=== Extract user's ShortId prefix ===\n");

  const userIdResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;

        // Get the userId from labels settings
        const userId = ga?.labels?._settings?._cache?.userId;

        if (!userId) return { error: 'No userId found' };

        // Extract the suffix (after user_)
        const suffix = userId.replace('user_', '');

        // The user prefix appears to be at positions 7-10 of the suffix
        // suffix = "11SzDPi4sKPTbHQRMQ"
        // position 7-10 = "4sKP"
        const userPrefix = suffix.substring(7, 11);

        return {
          userId,
          suffix,
          userPrefix,
          prefixPosition: '7-10',
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("User ID analysis:");
  console.log(JSON.stringify(userIdResult.result.value, null, 2));

  const userPrefix = userIdResult.result.value?.userPrefix;

  if (!userPrefix) {
    console.error("Could not extract user prefix");
    await disconnect(conn);
    return;
  }

  console.log(`\nExtracted user prefix: "${userPrefix}"\n`);

  console.log("=== Generate test event IDs ===\n");

  // Generate some test IDs
  for (let i = 0; i < 5; i++) {
    const id = generateEventId(userPrefix);
    console.log(`Generated: ${id} (length: ${id.length})`);
  }

  console.log("\n=== Compare with real event IDs ===\n");

  // Get some real event IDs for comparison
  const realIdsResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const portal = di?.get?.('portal');

        const sessions = await portal.invoke('agentSessionsInternal', 'getAllSessions', []);
        const eventIds = [];

        for (const session of sessions.slice(0, 5)) {
          try {
            const json = JSON.parse(session.json);
            if (json.events?.[0]?.payload?.event_id) {
              eventIds.push(json.events[0].payload.event_id);
            }
          } catch {}
        }

        return eventIds;
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("Real event IDs for comparison:");
  const realIds = realIdsResult.result.value || [];
  realIds.forEach((id: string) => {
    const suffix = id.replace('event_', '');
    console.log(`  ${id}`);
    console.log(`    Timestamp portion: ${suffix.substring(0, 7)}`);
    console.log(`    User prefix: ${suffix.substring(7, 11)}`);
    console.log(`    Random portion: ${suffix.substring(11)}`);
  });

  console.log("\n=== Validate by decoding timestamp ===\n");

  // Decode timestamps from real IDs
  function decodeTimestamp(str: string): number {
    let result = 0;
    for (let i = 0; i < str.length; i++) {
      result = result * 64 + PUSH_CHARS.indexOf(str[i]);
    }
    return result;
  }

  for (const id of realIds.slice(0, 3)) {
    const suffix = id.replace('event_', '');
    const timestampPortion = suffix.substring(0, 7);
    const decoded = decodeTimestamp(timestampPortion);
    const date = new Date(decoded);
    console.log(`ID: ${id}`);
    console.log(`  Timestamp chars: ${timestampPortion}`);
    console.log(`  Decoded: ${decoded}`);
    console.log(`  As date: ${date.toISOString()}`);
    console.log(`  Valid date: ${!isNaN(date.getTime()) && date.getFullYear() > 2020 && date.getFullYear() < 2030}`);
    console.log('');
  }

  console.log("=== Test with a newly generated ID ===\n");

  const testId = generateEventId(userPrefix);
  const testSuffix = testId.replace('event_', '');
  const testTimestamp = decodeTimestamp(testSuffix.substring(0, 7));
  console.log(`Generated: ${testId}`);
  console.log(`  Timestamp decoded: ${testTimestamp}`);
  console.log(`  As date: ${new Date(testTimestamp).toISOString()}`);
  console.log(`  Current time: ${new Date().toISOString()}`);
  console.log(`  Diff (ms): ${Date.now() - testTimestamp}`);

  await disconnect(conn);
}

main().catch(console.error);
