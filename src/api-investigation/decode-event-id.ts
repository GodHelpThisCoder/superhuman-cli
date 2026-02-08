/**
 * Decode the actual event ID format
 *
 * The Firebase Push charset doesn't decode to valid timestamps, so Superhuman
 * must be using a different charset or encoding scheme.
 *
 * Let's try different charsets and see which one works.
 */

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
const BASE62_UPPER_FIRST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const BASE62_LOWER_FIRST = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BASE62_DIGITS_FIRST = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// Real event IDs from recent sessions
const realIds = [
  'event_11VNPF94sKPO6AMXRZ',  // From 2026-02-05T03:04:11
  'event_11VNPEM4sKPzY6CQsu',  // From 2026-02-05T03:03:48
  'event_11VNPth4sKPNc6w5fa',  // From 2026-02-05T02:51:55
];

// Expected timestamps (from session data)
const expectedTimestamps = [
  new Date('2026-02-05T03:04:11.643Z').getTime(), // 1770260651643
  new Date('2026-02-05T03:03:48.545Z').getTime(), // 1770260628545
  new Date('2026-02-05T02:51:55.336Z').getTime(), // 1770259915336
];

function decodeWithCharset(str: string, charset: string): number {
  let result = 0;
  const base = charset.length;
  for (let i = 0; i < str.length; i++) {
    const idx = charset.indexOf(str[i]);
    if (idx === -1) return -1;
    result = result * base + idx;
  }
  return result;
}

function encodeWithCharset(num: number, len: number, charset: string): string {
  let result = '';
  const base = charset.length;
  for (let i = len - 1; i >= 0; i--) {
    result = charset.charAt(num % base) + result;
    num = Math.floor(num / base);
  }
  return result;
}

console.log("=== Testing different charsets ===\n");

const charsets = {
  'Firebase Push': PUSH_CHARS,
  'Base62 (A-Z first)': BASE62_UPPER_FIRST,
  'Base62 (a-z first)': BASE62_LOWER_FIRST,
  'Base62 (0-9 first)': BASE62_DIGITS_FIRST,
};

for (const [name, charset] of Object.entries(charsets)) {
  console.log(`\n--- ${name} (${charset.length} chars) ---`);

  for (let i = 0; i < realIds.length; i++) {
    const id = realIds[i];
    const suffix = id.replace('event_', '');

    // Try different portions
    for (const len of [6, 7, 8]) {
      const timestampPortion = suffix.substring(0, len);
      const decoded = decodeWithCharset(timestampPortion, charset);
      const date = new Date(decoded);
      const isValid = !isNaN(date.getTime()) && date.getFullYear() >= 2020 && date.getFullYear() <= 2030;

      if (isValid) {
        console.log(`  ${id}`);
        console.log(`    Portion: ${timestampPortion} (len=${len})`);
        console.log(`    Decoded: ${decoded}`);
        console.log(`    Date: ${date.toISOString()}`);
        console.log(`    Expected: ~${new Date(expectedTimestamps[i]).toISOString()}`);
        console.log(`    Diff: ${Math.abs(decoded - expectedTimestamps[i])}ms`);
      }
    }
  }
}

console.log("\n=== Reverse engineering: encode expected timestamps ===\n");

for (const [name, charset] of Object.entries(charsets)) {
  console.log(`\n--- ${name} ---`);

  const timestamp = expectedTimestamps[0];
  console.log(`Timestamp: ${timestamp}`);

  for (const len of [6, 7, 8, 9]) {
    const encoded = encodeWithCharset(timestamp, len, charset);
    console.log(`  Encoded (len=${len}): ${encoded}`);

    // Check if it matches the pattern
    const realSuffix = realIds[0].replace('event_', '');
    console.log(`  Real suffix starts with: ${realSuffix.substring(0, len)}`);
  }
}

console.log("\n=== Check if the first 2 chars '11' are constant ===\n");

// Maybe '11' is a version/format prefix, not part of the timestamp
const prefixesToTry = ['', '11', '11V'];

for (const prefix of prefixesToTry) {
  console.log(`\n--- Assuming prefix "${prefix}" is not timestamp ---`);

  for (const [name, charset] of Object.entries(charsets)) {
    const suffix = realIds[0].replace('event_', '').substring(prefix.length);
    const timestampPortion = suffix.substring(0, 7 - prefix.length);

    if (timestampPortion.length < 3) continue;

    const decoded = decodeWithCharset(timestampPortion, charset);
    const date = new Date(decoded);
    const isValid = !isNaN(date.getTime()) && date.getFullYear() >= 2020 && date.getFullYear() <= 2030;

    if (isValid) {
      console.log(`  ${name}: ${timestampPortion} -> ${decoded} -> ${date.toISOString()}`);
    }
  }
}

console.log("\n=== Try to find the relationship between user_11S... and event_11V... ===\n");

// Both start with "11", suggesting this is a format version or account identifier
// user_11SzDPi4sKPTbHQRMQ
// event_11VNPF94sKPO6AMXRZ

// The "11" appears to be constant
// The next chars differ: S vs V (for user vs event?)
// Then more chars that vary

// Let's see if there's a pattern
const userId = 'user_11SzDPi4sKPTbHQRMQ';
const userSuffix = userId.replace('user_', '');

console.log(`User suffix:  ${userSuffix}`);
console.log(`Event suffix: ${realIds[0].replace('event_', '')}`);

console.log("\nPosition analysis:");
for (let i = 0; i < Math.min(userSuffix.length, 18); i++) {
  const userChar = userSuffix[i];
  const eventChar = realIds[0].replace('event_', '')[i];
  const match = userChar === eventChar ? '=' : '≠';
  console.log(`  Position ${i.toString().padStart(2)}: user='${userChar}' ${match} event='${eventChar}'`);
}

console.log("\n=== Check if only the '4sKP' part matches ===\n");

// Extract the 4sKP from both
console.log(`User 4sKP location: positions 7-10 = "${userSuffix.substring(7, 11)}"`);
console.log(`Event 4sKP location: positions 7-10 = "${realIds[0].replace('event_', '').substring(7, 11)}"`);

console.log("\n=== Hypothesis: The ID is NOT timestamp-based ===\n");

// Maybe it's a cuid2 or similar format?
// Let's try to understand the structure differently

// Looking at patterns across different IDs:
// - All start with "11V"
// - Position 3: varies (N, y, u, s, q, M, C, etc.)
// - Position 4-6: varies
// - Position 7-10: "4sKP" (constant for this user)
// - Position 11-17: varies (random)

console.log("Pattern hypothesis:");
console.log("  Position 0-2: '11V' - format version?");
console.log("  Position 3: varies (N/G/s/n/M/C/y/v/u/r/q) - category?");
console.log("  Position 4-6: varies - timestamp or random");
console.log("  Position 7-10: '4sKP' - user identifier");
console.log("  Position 11-17: varies - random suffix");

// Generate a test ID using this structure
function generateEventIdV2(userPrefix: string): string {
  const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  // Format prefix: "11V"
  const formatPrefix = '11V';

  // Category char (just use random)
  const category = BASE62.charAt(Math.floor(Math.random() * BASE62.length));

  // 3 more chars (could be timestamp-based)
  const timestamp = Date.now();
  const timestampChars = encodeWithCharset(timestamp % (62*62*62), 3, BASE62);

  // User prefix: "4sKP"
  // 7 random chars
  let randomSuffix = '';
  for (let i = 0; i < 7; i++) {
    randomSuffix += BASE62.charAt(Math.floor(Math.random() * BASE62.length));
  }

  return `event_${formatPrefix}${category}${timestampChars}${userPrefix}${randomSuffix}`;
}

console.log("\n=== Generate test IDs with new algorithm ===\n");

for (let i = 0; i < 5; i++) {
  console.log(generateEventIdV2('4sKP'));
}

console.log("\nCompare to real:");
for (const id of realIds) {
  console.log(id);
}
