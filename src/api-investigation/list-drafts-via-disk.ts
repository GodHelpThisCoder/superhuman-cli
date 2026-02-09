#!/usr/bin/env bun
/**
 * List Drafts via Disk/Thread Service
 *
 * Uses the disk/thread.listAsync or threads.listAsync methods to get draft threads.
 */

import { connectToSuperhuman } from "../superhuman-api";

async function listDraftsViaDisk(conn: { Runtime: any }) {
  const { Runtime } = conn;

  console.log("\n=== STEP 1: Try disk/thread.listAsync with DRAFT ===\n");

  const diskListResult = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const diskThread = di.get?.('disk/thread');
          if (!diskThread) return { error: "No disk/thread service" };

          // Try listAsync with DRAFT label
          if (typeof diskThread.listAsync === 'function') {
            try {
              // Try different parameter formats
              const result = await diskThread.listAsync(['DRAFT']);
              return {
                method: 'diskThread.listAsync(["DRAFT"])',
                type: typeof result,
                isArray: Array.isArray(result),
                length: Array.isArray(result) ? result.length : undefined,
                sample: Array.isArray(result) && result.length > 0
                  ? result.slice(0, 3).map(t => ({
                      id: t.id || t.threadId,
                      keys: Object.keys(t).slice(0, 15),
                    }))
                  : null,
              };
            } catch (e) {
              return { error: 'listAsync failed: ' + e.message };
            }
          }

          return { error: "No listAsync method" };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log("disk/thread.listAsync:", JSON.stringify(diskListResult.result.value, null, 2));

  console.log("\n=== STEP 2: Try threads.listAsync ===\n");

  const threadsListResult = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const threads = ga?.threads;

          if (!threads) return { error: "No threads service" };

          if (typeof threads.listAsync === 'function') {
            try {
              // Try calling listAsync
              const result = await threads.listAsync('DRAFT');
              return {
                method: 'threads.listAsync("DRAFT")',
                type: typeof result,
                isArray: Array.isArray(result),
                length: Array.isArray(result) ? result.length : undefined,
                keys: typeof result === 'object' ? Object.keys(result || {}).slice(0, 20) : [],
                sample: Array.isArray(result) && result.length > 0
                  ? result.slice(0, 3).map(t => ({
                      id: t.id || t.threadId,
                      keys: Object.keys(t).slice(0, 15),
                    }))
                  : null,
              };
            } catch (e) {
              return { error: 'listAsync failed: ' + e.message };
            }
          }

          return { error: "No listAsync method" };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log("threads.listAsync:", JSON.stringify(threadsListResult.result.value, null, 2));

  console.log("\n=== STEP 3: Try disk/list service ===\n");

  const diskListService = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const diskList = di.get?.('disk/list');
          if (!diskList) return { error: "No disk/list service" };

          const result = {
            type: typeof diskList,
            keys: Object.keys(diskList).slice(0, 20),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(diskList) || {})
              .filter(k => typeof diskList[k] === 'function').slice(0, 20),
          };

          // Try to get DRAFT list
          for (const method of ['get', 'getAsync', 'list', 'listAsync']) {
            if (typeof diskList[method] === 'function') {
              try {
                const data = await diskList[method]('DRAFT');
                if (data) {
                  result[method] = {
                    type: typeof data,
                    isArray: Array.isArray(data),
                    length: Array.isArray(data) ? data.length : undefined,
                    keys: typeof data === 'object' ? Object.keys(data).slice(0, 10) : [],
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
  console.log("disk/list service:", JSON.stringify(diskListService.result.value, null, 2));

  console.log("\n=== STEP 4: Try gmail.getThreadList with DRAFT ===\n");

  const gmailThreadList = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const gmail = di.get?.('gmail');
          if (!gmail) return { error: "No gmail service" };

          if (typeof gmail.getThreadList === 'function') {
            try {
              // Try calling getThreadList with DRAFT query
              const result = await gmail.getThreadList({ labelIds: ['DRAFT'], maxResults: 10 });
              return {
                method: 'gmail.getThreadList({ labelIds: ["DRAFT"] })',
                type: typeof result,
                isArray: Array.isArray(result),
                length: Array.isArray(result) ? result.length : undefined,
                keys: typeof result === 'object' ? Object.keys(result || {}).slice(0, 20) : [],
              };
            } catch (e) {
              return { error: 'getThreadList failed: ' + e.message };
            }
          }

          return { error: "No getThreadList method" };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log("gmail.getThreadList:", JSON.stringify(gmailThreadList.result.value, null, 2));

  console.log("\n=== STEP 5: Check identityMap for draft threads ===\n");

  const identityMapDrafts = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const threads = ga?.threads;

          if (!threads) return { error: "No threads service" };

          const identityMap = threads.identityMap;
          if (!identityMap) return { error: "No identityMap" };

          const result = {
            type: typeof identityMap,
            isMap: identityMap instanceof Map,
          };

          if (identityMap instanceof Map) {
            result.size = identityMap.size;

            // Find all draft entries
            const entries = Array.from(identityMap.entries());
            const draftEntries = entries.filter(([k]) =>
              typeof k === 'string' && k.startsWith('draft')
            );

            result.draftCount = draftEntries.length;
            result.sampleDrafts = draftEntries.slice(0, 5).map(([id, presenter]) => {
              const p = presenter;
              return {
                id,
                presenterType: typeof p,
                presenterKeys: p ? Object.keys(p).slice(0, 15) : [],
                thread: p?.thread ? {
                  id: p.thread.id,
                  subject: p.thread.subject || p.thread._subject,
                  snippet: p.thread.snippet?.substring?.(0, 50),
                } : null,
              };
            });

            // Show some sample IDs to understand the pattern
            result.sampleIds = entries.slice(0, 10).map(([k]) => k);
          }

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("identityMap drafts:", JSON.stringify(identityMapDrafts.result.value, null, 2));

  console.log("\n=== STEP 6: Try getAllAsync from disk/thread ===\n");

  const getAllResult = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const diskThread = di.get?.('disk/thread');
          if (!diskThread) return { error: "No disk/thread service" };

          if (typeof diskThread.getAllAsync === 'function') {
            try {
              const allThreads = await diskThread.getAllAsync();

              if (!allThreads) return { error: "getAllAsync returned null" };

              const result = {
                type: typeof allThreads,
                isArray: Array.isArray(allThreads),
                length: Array.isArray(allThreads) ? allThreads.length : undefined,
              };

              if (Array.isArray(allThreads)) {
                // Filter for draft threads
                const draftThreads = allThreads.filter(t =>
                  (t.id && t.id.startsWith('draft')) ||
                  (t.threadId && t.threadId.startsWith('draft')) ||
                  (t.labelIds && t.labelIds.includes('DRAFT'))
                );

                result.draftCount = draftThreads.length;
                result.sampleDrafts = draftThreads.slice(0, 5).map(t => ({
                  id: t.id || t.threadId,
                  subject: t.subject,
                  snippet: t.snippet?.substring?.(0, 50),
                  labelIds: t.labelIds?.slice?.(0, 5),
                  keys: Object.keys(t).slice(0, 15),
                }));
              }

              return result;
            } catch (e) {
              return { error: 'getAllAsync failed: ' + e.message };
            }
          }

          return { error: "No getAllAsync method" };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log("disk/thread.getAllAsync:", JSON.stringify(getAllResult.result.value, null, 2));

  console.log("\n=== STEP 7: Check for native draft in onDisk property ===\n");

  const onDiskDrafts = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const threads = ga?.threads;

          if (!threads) return { error: "No threads service" };

          const onDisk = threads.onDisk;
          if (!onDisk) return { error: "No onDisk" };

          const result = {
            type: typeof onDisk,
            keys: Object.keys(onDisk).slice(0, 20),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(onDisk) || {})
              .filter(k => typeof onDisk[k] === 'function').slice(0, 20),
          };

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("threads.onDisk:", JSON.stringify(onDiskDrafts.result.value, null, 2));
}

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333, false);
  if (!conn) {
    console.error("Failed to connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    process.exit(1);
  }

  console.log("Connected! Listing drafts...\n");

  try {
    await listDraftsViaDisk(conn);
  } finally {
    process.exit(0);
  }
}

main();
