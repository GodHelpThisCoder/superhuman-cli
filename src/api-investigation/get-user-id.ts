/**
 * Get user ID for event generation
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const credential = ga?.credential;

        const user = credential?.user;

        return {
          userId: user?._id,
          userName: user?._name,
          provider: user?._provider,
          emailAddress: user?.emailAddress,
          // Get more context
          billingSettings: user?._billingSettings ? Object.keys(user._billingSettings) : null,
          miscSettings: user?._miscSettings ? Object.keys(user._miscSettings) : null,
        };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}
main();
