import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const { Runtime } = conn;

  // Explore SQLite storage
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const disk = di.get('disk');

        const findings = {};

        // Check sqliteProxy
        const sqliteProxy = disk?.sqliteProxy || di.get('sqliteProxy');
        if (sqliteProxy) {
          findings.sqliteProxy = {
            type: typeof sqliteProxy,
            methods: Object.keys(sqliteProxy).filter(k => typeof sqliteProxy[k] === 'function').slice(0, 30),
            props: Object.keys(sqliteProxy).filter(k => typeof sqliteProxy[k] !== 'function').slice(0, 20)
          };
        }

        // Check disk/thread for draft storage
        const diskThread = disk?.thread;
        if (diskThread) {
          findings.diskThread = {
            type: typeof diskThread,
            methods: Object.keys(diskThread).filter(k => typeof diskThread[k] === 'function'),
            props: Object.keys(diskThread).filter(k => typeof diskThread[k] !== 'function').slice(0, 20)
          };

          // Try to find drafts in thread cache
          if (diskThread._cache) {
            const draftKeys = [];
            try {
              for (const key of Object.keys(diskThread._cache)) {
                if (key.includes('draft')) {
                  draftKeys.push(key);
                }
              }
            } catch {}
            findings.draftKeysInCache = draftKeys.slice(0, 10);
          }
        }

        // Check disk/modifier for pending operations
        const diskModifier = disk?.modifier;
        if (diskModifier) {
          findings.diskModifier = {
            type: typeof diskModifier,
            methods: Object.keys(diskModifier).filter(k => typeof diskModifier[k] === 'function'),
            props: Object.keys(diskModifier).filter(k => typeof diskModifier[k] !== 'function').slice(0, 20)
          };

          // Check for pending modifiers (draft operations)
          if (diskModifier._pending) {
            findings.pendingModifiers = Object.keys(diskModifier._pending).slice(0, 10);
          }
          if (diskModifier._queue) {
            findings.modifierQueueLength = diskModifier._queue.length;
          }
        }

        // Try to query for drafts directly
        try {
          const threads = di.get('threads');
          if (threads) {
            // Look for getList or similar method that could return drafts
            findings.threadsMethods = Object.keys(threads).filter(k =>
              typeof threads[k] === 'function' &&
              (k.includes('get') || k.includes('list') || k.includes('fetch'))
            );
          }
        } catch {}

        // Check for any SharedDraft in threads
        const threads = di.get('threads');
        if (threads) {
          // Look for shared draft handling
          const sharedDraftMethods = Object.keys(threads).filter(k =>
            k.toLowerCase().includes('shared') ||
            k.toLowerCase().includes('team')
          );
          findings.sharedDraftMethods = sharedDraftMethods;
        }

        return findings;
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log("SQLite/Disk investigation:", JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
