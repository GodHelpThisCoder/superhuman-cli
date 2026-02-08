import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const account = window.ViewState?.account;
        const settings = account?.settings;

        return {
          currentEmail: account?.emailAddress,
          // Get snippets from settings.get()
          snippetsFromGet: settings?.get?.('snippets'),
          // Get snippets from cache directly
          snippetsFromCache: settings?._cache?.snippets,
          // Count
          snippetCount: Object.keys(settings?._cache?.snippets || {}).length
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("=== Current Account Snippets ===\n");
  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
