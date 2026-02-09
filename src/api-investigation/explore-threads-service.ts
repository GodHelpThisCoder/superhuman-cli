#!/usr/bin/env bun
/**
 * Explore Threads Service for Native Drafts
 *
 * The threads service has methods like getPresenter, getNewDraftPresenter.
 * This investigates how to list native drafts through it.
 */

import { connectToSuperhuman } from "../superhuman-api";

async function exploreThreadsService(conn: { Runtime: any }) {
  const { Runtime } = conn;

  console.log("\n=== STEP 1: Explore threads service in detail ===\n");

  const threadsInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const threads = ga?.threads;

          if (!threads) return { error: "No threads service" };

          const result = {
            keys: Object.keys(threads).slice(0, 30),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(threads) || {})
              .filter(k => typeof threads[k] === 'function'),
          };

          // Check for draft-related properties
          const draftProps = Object.keys(threads).filter(k =>
            k.toLowerCase().includes('draft') ||
            k.toLowerCase().includes('presenter')
          );
          result.draftProps = draftProps;

          // Check replacedIds map
          if (threads.replacedIds) {
            result.replacedIds = {
              type: typeof threads.replacedIds,
              isMap: threads.replacedIds instanceof Map,
              size: threads.replacedIds instanceof Map ? threads.replacedIds.size : Object.keys(threads.replacedIds).length,
            };
          }

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("Threads service:", JSON.stringify(threadsInfo.result.value, null, 2));

  console.log("\n=== STEP 2: Look for presenters with draft IDs ===\n");

  const presenterInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const threads = ga?.threads;

          if (!threads) return { error: "No threads service" };

          const result = {
            presenters: [],
          };

          // Check for _presenters or similar cache
          const possibleCaches = ['_presenters', 'presenters', '_cache', 'cache', '_presenterCache'];
          for (const prop of possibleCaches) {
            if (threads[prop]) {
              const cache = threads[prop];
              result[prop] = {
                type: typeof cache,
                isMap: cache instanceof Map,
              };

              if (cache instanceof Map) {
                const entries = Array.from(cache.entries());
                result[prop].size = entries.length;

                // Filter for draft IDs
                const draftEntries = entries.filter(([k]) =>
                  k.startsWith('draft') || k.includes('draft')
                );
                result[prop].draftCount = draftEntries.length;

                if (draftEntries.length > 0) {
                  result[prop].sampleDrafts = draftEntries.slice(0, 3).map(([k, v]) => ({
                    id: k,
                    type: typeof v,
                    keys: Object.keys(v || {}).slice(0, 15),
                  }));
                }

                // Also show some sample keys
                result[prop].sampleKeys = entries.slice(0, 10).map(([k]) => k);
              }
            }
          }

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("Presenter info:", JSON.stringify(presenterInfo.result.value, null, 2));

  console.log("\n=== STEP 3: Explore DI 'disk/thread' service ===\n");

  const diskThreadInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const diskThread = di.get?.('disk/thread');
          if (!diskThread) return { error: "No disk/thread service" };

          return {
            type: typeof diskThread,
            keys: Object.keys(diskThread).slice(0, 30),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(diskThread) || {})
              .filter(k => typeof diskThread[k] === 'function').slice(0, 30),
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("disk/thread service:", JSON.stringify(diskThreadInfo.result.value, null, 2));

  console.log("\n=== STEP 4: Try to list all thread IDs from disk ===\n");

  const diskThreadIds = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const diskThread = di.get?.('disk/thread');
          if (!diskThread) return { error: "No disk/thread service" };

          const result = {
            methods: [],
            draftThreads: [],
          };

          // Check for methods that might list threads
          const proto = Object.getPrototypeOf(diskThread);
          const methods = Object.getOwnPropertyNames(proto || {})
            .filter(k => typeof diskThread[k] === 'function');
          result.methods = methods;

          // Try to get all thread IDs
          if (typeof diskThread.getAllThreadIds === 'function') {
            const ids = await diskThread.getAllThreadIds();
            if (Array.isArray(ids)) {
              result.totalThreads = ids.length;
              result.draftThreads = ids.filter(id => id.startsWith('draft')).slice(0, 10);
            }
          }

          // Try getAll or list methods
          for (const method of ['getAll', 'list', 'getAllThreads', 'keys']) {
            if (typeof diskThread[method] === 'function') {
              try {
                const data = await diskThread[method]();
                if (data) {
                  result[method] = {
                    type: typeof data,
                    isArray: Array.isArray(data),
                    length: Array.isArray(data) ? data.length : undefined,
                  };
                }
              } catch (e) {
                result[method] = { error: e.message };
              }
            }
          }

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log("disk/thread IDs:", JSON.stringify(diskThreadIds.result.value, null, 2));

  console.log("\n=== STEP 5: Check listRouter or listCounts ===\n");

  const listRouterInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const listRouter = di.get?.('listRouter');
          const listCounts = di.get?.('listCounts');

          const result = {};

          if (listRouter) {
            result.listRouter = {
              type: typeof listRouter,
              keys: Object.keys(listRouter).slice(0, 20),
              methods: Object.getOwnPropertyNames(Object.getPrototypeOf(listRouter) || {})
                .filter(k => typeof listRouter[k] === 'function').slice(0, 20),
            };
          }

          if (listCounts) {
            result.listCounts = {
              type: typeof listCounts,
              keys: Object.keys(listCounts).slice(0, 20),
            };

            // Try to get draft count
            if (listCounts._counts) {
              const counts = listCounts._counts;
              if (counts instanceof Map) {
                const draftCount = counts.get('DRAFT');
                result.draftCount = draftCount;
                result.allCounts = Object.fromEntries(Array.from(counts.entries()).slice(0, 10));
              }
            }
          }

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("listRouter/listCounts:", JSON.stringify(listRouterInfo.result.value, null, 2));

  console.log("\n=== STEP 6: Look for disk service with draft access ===\n");

  const diskInfo = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const disk = di.get?.('disk');
          if (!disk) return { error: "No disk service" };

          const result = {
            type: typeof disk,
            keys: Object.keys(disk).slice(0, 30),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(disk) || {})
              .filter(k => typeof disk[k] === 'function').slice(0, 30),
          };

          // Try to query drafts
          if (typeof disk.queryThreads === 'function') {
            try {
              const drafts = await disk.queryThreads({ labelIds: ['DRAFT'] });
              if (drafts) {
                result.draftQuery = {
                  type: typeof drafts,
                  isArray: Array.isArray(drafts),
                  length: Array.isArray(drafts) ? drafts.length : undefined,
                };
                if (Array.isArray(drafts) && drafts.length > 0) {
                  result.sampleDraft = {
                    id: drafts[0].id || drafts[0].threadId,
                    keys: Object.keys(drafts[0]).slice(0, 15),
                  };
                }
              }
            } catch (e) {
              result.draftQueryError = e.message;
            }
          }

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log("disk service:", JSON.stringify(diskInfo.result.value, null, 2));

  console.log("\n=== STEP 7: Explore gmail/msgraph services for drafts ===\n");

  const providerInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const isMicrosoft = !!di.get?.('isMicrosoft');
          const result = { isMicrosoft };

          // Get the appropriate provider service
          const providerName = isMicrosoft ? 'msgraph' : 'gmail';
          const provider = di.get?.(providerName);

          if (!provider) {
            result.error = 'No ' + providerName + ' service';
            return result;
          }

          result[providerName] = {
            type: typeof provider,
            keys: Object.keys(provider).slice(0, 30),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(provider) || {})
              .filter(k => typeof provider[k] === 'function').slice(0, 40),
          };

          // Look for draft-specific methods
          result.draftMethods = result[providerName].methods.filter(m =>
            m.toLowerCase().includes('draft')
          );

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("Provider service:", JSON.stringify(providerInfo.result.value, null, 2));

  console.log("\n=== STEP 8: Try to get draft list via gmail service ===\n");

  const gmailDrafts = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const isMicrosoft = !!di.get?.('isMicrosoft');
          const providerName = isMicrosoft ? 'msgraph' : 'gmail';
          const provider = di.get?.(providerName);

          if (!provider) return { error: "No provider" };

          const result = { isMicrosoft, providerName };

          // Try various methods to get drafts
          const draftMethods = ['listDrafts', 'getDrafts', 'drafts', 'fetchDrafts'];
          for (const method of draftMethods) {
            if (typeof provider[method] === 'function') {
              try {
                const drafts = await provider[method]();
                result[method] = {
                  success: true,
                  type: typeof drafts,
                  isArray: Array.isArray(drafts),
                  length: Array.isArray(drafts) ? drafts.length : undefined,
                };
                if (Array.isArray(drafts) && drafts.length > 0) {
                  result[method].sample = {
                    id: drafts[0].id,
                    keys: Object.keys(drafts[0]).slice(0, 10),
                  };
                }
              } catch (e) {
                result[method] = { error: e.message };
              }
            }
          }

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log("Provider drafts:", JSON.stringify(gmailDrafts.result.value, null, 2));
}

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333, false);
  if (!conn) {
    console.error("Failed to connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    process.exit(1);
  }

  console.log("Connected! Starting exploration...\n");

  try {
    await exploreThreadsService(conn);
  } finally {
    process.exit(0);
  }
}

main();
