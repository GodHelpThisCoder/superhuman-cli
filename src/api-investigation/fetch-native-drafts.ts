#!/usr/bin/env bun
/**
 * Fetch Native Drafts from Superhuman Backend
 *
 * Investigates how to list Superhuman's native drafts (draft00...) using
 * the backend API (readUserData / getThreads).
 */

import { connectToSuperhuman } from "../superhuman-api";

async function fetchNativeDrafts(conn: { Runtime: any }) {
  const { Runtime } = conn;

  console.log("\n=== STEP 1: Get user info and check account type ===\n");

  const userInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const credential = ga?.credential;
          const user = credential?.user;
          const backend = ga?.backend;

          return {
            email: ga?.emailAddress,
            userId: user?._id,
            isMicrosoft: !!backend?._isMicrosoft,
            hasBackend: !!backend,
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("User info:", JSON.stringify(userInfo.result.value, null, 2));

  console.log("\n=== STEP 2: Try backend.getThreads with DRAFT label ===\n");

  // Try to get threads with DRAFT label
  const draftThreads = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const backend = ga?.backend;

          if (!backend) return { error: "No backend" };

          // Try calling getThreads with draft filter
          // This is an async function that may return a promise
          if (typeof backend.getThreads === 'function') {
            try {
              // Try different call patterns
              const result = await backend.getThreads({
                labelIds: ['DRAFT'],
                maxResults: 10,
              });
              return {
                method: 'getThreads({labelIds: ["DRAFT"]})',
                result: result,
                type: typeof result,
                isArray: Array.isArray(result),
              };
            } catch (e) {
              return { error: 'getThreads failed: ' + e.message };
            }
          }

          return { error: "No getThreads method" };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log("Draft threads result:", JSON.stringify(draftThreads.result.value, null, 2));

  console.log("\n=== STEP 3: Explore DI container for draft services ===\n");

  const diServices = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI container" };

          // Get registry and list all services
          const result = {
            allServices: [],
            draftRelated: [],
          };

          // Try to get service names from _registry
          const registry = di._registry || di.registry || di._container || di.container;
          if (registry) {
            if (registry instanceof Map) {
              result.allServices = Array.from(registry.keys());
            } else if (typeof registry === 'object') {
              result.allServices = Object.keys(registry);
            }
          }

          // Filter for draft-related services
          result.draftRelated = result.allServices.filter(s =>
            s.toLowerCase().includes('draft') ||
            s.toLowerCase().includes('compose') ||
            s.toLowerCase().includes('message') ||
            s.toLowerCase().includes('thread')
          );

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("DI services:", JSON.stringify(diServices.result.value, null, 2));

  console.log("\n=== STEP 4: Try readUserData for drafts ===\n");

  const readUserDataResult = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const backend = ga?.backend;
          const credential = ga?.credential;
          const userId = credential?.user?._id;

          if (!backend || !userId) return { error: "Missing backend or userId" };

          // Try readUserData with draft path
          if (typeof backend.readUserData === 'function') {
            try {
              // Superhuman stores drafts at paths like: users/{userId}/drafts
              // or users/{userId}/threads/{threadId}/messages/{draftId}/draft
              const path = 'users/' + userId + '/drafts';
              const result = await backend.readUserData([path]);
              return {
                method: 'readUserData([path])',
                path: path,
                result: result,
                type: typeof result,
              };
            } catch (e) {
              return { error: 'readUserData failed: ' + e.message };
            }
          }

          return { error: "No readUserData method" };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log("readUserData result:", JSON.stringify(readUserDataResult.result.value, null, 2));

  console.log("\n=== STEP 5: Look for threadStore or message cache ===\n");

  const cacheInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;

          // Look for various cache/store properties
          const stores = ['threadStore', '_threadStore', 'messages', '_messages',
                          'threads', '_threads', 'cache', '_cache', 'store', '_store'];

          const result = {};
          for (const store of stores) {
            if (ga[store]) {
              const val = ga[store];
              let info = {
                type: typeof val,
              };

              if (val instanceof Map) {
                info.size = val.size;
                info.sampleKeys = Array.from(val.keys()).slice(0, 5);
              } else if (typeof val === 'object' && val !== null) {
                const keys = Object.keys(val);
                info.keyCount = keys.length;
                info.sampleKeys = keys.slice(0, 5);
                info.methods = Object.getOwnPropertyNames(Object.getPrototypeOf(val) || {})
                  .filter(k => typeof val[k] === 'function').slice(0, 20);
              }

              result[store] = info;
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
  console.log("Cache info:", JSON.stringify(cacheInfo.result.value, null, 2));

  console.log("\n=== STEP 6: Check labels service ===\n");

  const labelsInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const labels = ga?.labels;

          if (!labels) return { error: "No labels" };

          return {
            type: typeof labels,
            keys: Object.keys(labels).slice(0, 20),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(labels) || {})
              .filter(k => typeof labels[k] === 'function').slice(0, 30),
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("Labels info:", JSON.stringify(labelsInfo.result.value, null, 2));

  console.log("\n=== STEP 7: Try to access draft lists via labels ===\n");

  const draftListInfo = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const labels = ga?.labels;

          if (!labels) return { error: "No labels service" };

          // Check if there's a way to get draft threads via labels
          const result = {
            draftLabel: null,
            draftThreads: [],
          };

          // Try to find DRAFT label and get its threads
          if (labels._labels) {
            const draftLabel = labels._labels.get?.('DRAFT') || labels._labels['DRAFT'];
            if (draftLabel) {
              result.draftLabel = {
                type: typeof draftLabel,
                keys: Object.keys(draftLabel).slice(0, 20),
              };

              // Try to get threads from this label
              if (draftLabel._threads || draftLabel.threads) {
                const threads = draftLabel._threads || draftLabel.threads;
                if (threads instanceof Map) {
                  const entries = Array.from(threads.entries()).slice(0, 5);
                  result.draftThreads = entries.map(([id, t]) => ({
                    id,
                    type: typeof t,
                    keys: Object.keys(t || {}).slice(0, 10),
                  }));
                }
              }
            }
          }

          // Also try getList method if available
          if (typeof labels.getList === 'function') {
            try {
              const list = await labels.getList('DRAFT');
              if (list) {
                result.draftListResult = {
                  type: typeof list,
                  keys: Object.keys(list).slice(0, 20),
                  length: Array.isArray(list) ? list.length : undefined,
                };
              }
            } catch (e) {
              result.getListError = e.message;
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
  console.log("Draft list info:", JSON.stringify(draftListInfo.result.value, null, 2));

  console.log("\n=== STEP 8: Explore cachedMatchers or cacheList ===\n");

  const cacheListInfo = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;

          // Try cacheList for DRAFT
          if (typeof ga.cacheList === 'function') {
            try {
              const cached = await ga.cacheList('DRAFT');
              if (cached) {
                return {
                  method: 'cacheList("DRAFT")',
                  type: typeof cached,
                  keys: Object.keys(cached || {}).slice(0, 20),
                  length: Array.isArray(cached) ? cached.length : undefined,
                };
              }
            } catch (e) {
              return { error: 'cacheList failed: ' + e.message };
            }
          }

          return { error: "No cacheList method" };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log("Cache list info:", JSON.stringify(cacheListInfo.result.value, null, 2));

  console.log("\n=== STEP 9: Try to get account-agnostic draft access ===\n");

  // Check if there's a way to access drafts that works for both Gmail and Outlook
  const agnosticDrafts = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const backend = ga?.backend;
          const di = ga?.di;

          const result = {
            isMicrosoft: !!backend?._isMicrosoft,
            backendClass: backend?.constructor?.name,
          };

          // Check if backend has same interface for both account types
          if (backend) {
            const proto = Object.getPrototypeOf(backend);
            const methods = Object.getOwnPropertyNames(proto || {})
              .filter(k => typeof backend[k] === 'function');

            result.hasSendEmail = methods.includes('sendEmail');
            result.hasGetThreads = methods.includes('getThreads');
            result.hasReadUserData = methods.includes('readUserData');
            result.hasWriteUserDataMessage = methods.includes('writeUserDataMessage');
          }

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("Agnostic draft access:", JSON.stringify(agnosticDrafts.result.value, null, 2));
}

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333, false);
  if (!conn) {
    console.error("Failed to connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    process.exit(1);
  }

  console.log("Connected! Starting fetch exploration...\n");

  try {
    await fetchNativeDrafts(conn);
  } finally {
    process.exit(0);
  }
}

main();
