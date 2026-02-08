import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const disk = ga?.disk;

        // Check disk.sync
        const sync = disk?.sync;
        const syncMethods = sync ? Object.keys(sync).filter(k => typeof sync[k] === "function") : [];
        const syncProps = sync ? Object.keys(sync).filter(k => typeof sync[k] !== "function" && !k.startsWith("_")) : [];

        // Check disk.modifier
        const modifier = disk?.modifier;
        const modifierMethods = modifier ? Object.keys(modifier).filter(k => typeof modifier[k] === "function") : [];

        // Check disk.thread
        const thread = disk?.thread;
        const threadMethods = thread ? Object.keys(thread).filter(k => typeof thread[k] === "function") : [];

        // Check if sync has a write or put method
        let syncApiMethods = null;
        if (sync?._api) {
          syncApiMethods = Object.keys(sync._api).filter(k => typeof sync._api[k] === "function");
        }

        return {
          syncMethods: syncMethods.slice(0, 40),
          syncProps: syncProps.slice(0, 20),
          modifierMethods: modifierMethods.slice(0, 40),
          threadMethods: threadMethods.slice(0, 40),
          syncApiMethods
        };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

main();
