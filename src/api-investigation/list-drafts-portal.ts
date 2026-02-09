#!/usr/bin/env bun
/**
 * List Drafts via Portal and Backend API
 *
 * Explores portal.invoke and backend API to list native Superhuman drafts.
 */

import { connectToSuperhuman } from "../superhuman-api";

async function listDraftsViaPortal(conn: { Runtime: any }) {
  const { Runtime } = conn;

  console.log("\n=== STEP 1: Explore portal service ===\n");

  const portalInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const portal = di.get?.('portal');
          if (!portal) return { error: "No portal service" };

          return {
            type: typeof portal,
            keys: Object.keys(portal).slice(0, 30),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(portal) || {})
              .filter(k => typeof portal[k] === 'function').slice(0, 30),
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("Portal service:", JSON.stringify(portalInfo.result.value, null, 2));

  console.log("\n=== STEP 2: Try portal.invoke for threads/drafts ===\n");

  const portalDrafts = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) return { error: "No DI" };

          const portal = di.get?.('portal');
          if (!portal || typeof portal.invoke !== 'function') {
            return { error: "No portal.invoke" };
          }

          const result = {};

          // Try various service/method combinations
          const attempts = [
            ['ThreadInternal', 'listAsync', [{ labelId: 'DRAFT', limit: 10 }]],
            ['ThreadInternal', 'listAsync', [{ labelIds: ['DRAFT'], limit: 10 }]],
            ['thread', 'listAsync', [{ labelId: 'DRAFT', limit: 10 }]],
            ['drafts', 'list', []],
            ['draft', 'list', []],
            ['DraftController', 'list', []],
          ];

          for (const [service, method, args] of attempts) {
            try {
              const data = await portal.invoke(service, method, args);
              result[service + '.' + method] = {
                success: true,
                type: typeof data,
                isArray: Array.isArray(data),
                length: Array.isArray(data) ? data.length : undefined,
                keys: typeof data === 'object' ? Object.keys(data || {}).slice(0, 10) : [],
              };
            } catch (e) {
              result[service + '.' + method] = { error: e.message };
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
  console.log("Portal drafts attempts:", JSON.stringify(portalDrafts.result.value, null, 2));

  console.log("\n=== STEP 3: Try backend.getThreads with proper format ===\n");

  const backendGetThreads = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const backend = ga?.backend;
          const credential = ga?.credential;
          const userId = credential?.user?._id;

          if (!backend || !userId) return { error: "Missing backend or userId" };

          const result = {};

          // Check backend._isMicrosoft
          result.isMicrosoft = !!backend._isMicrosoft;

          // Try getThreads with proper parameters
          if (typeof backend.getThreads === 'function') {
            // Look at what parameters getThreads expects
            result.getThreadsParams = backend.getThreads.toString().substring(0, 200);

            const attempts = [
              { labelIds: ['DRAFT'], limit: 10 },
              { label_ids: ['DRAFT'], limit: 10 },
              { listId: 'DRAFT', limit: 10 },
              'DRAFT',
            ];

            for (const params of attempts) {
              const key = JSON.stringify(params);
              try {
                const data = await backend.getThreads(params);
                result[key] = {
                  success: true,
                  type: typeof data,
                  keys: typeof data === 'object' ? Object.keys(data || {}).slice(0, 15) : [],
                };
              } catch (e) {
                result[key] = { error: e.message.substring(0, 100) };
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
  console.log("backend.getThreads:", JSON.stringify(backendGetThreads.result.value, null, 2));

  console.log("\n=== STEP 4: Look at Superhuman's list fetching logic ===\n");

  // Check if there's a ListStore or similar
  const listStoreInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;

          // Check for various list-related properties
          const result = {};

          const props = ['listStore', '_listStore', 'lists', '_lists',
                         'labelLists', '_labelLists'];
          for (const prop of props) {
            if (ga[prop]) {
              const val = ga[prop];
              result[prop] = {
                type: typeof val,
                keys: Object.keys(val).slice(0, 20),
              };
            }
          }

          // Check DI for list-related services
          const di = ga?.di;
          if (di) {
            const listServices = ['listStore', 'ListStore', 'lists', 'labelLists'];
            for (const svc of listServices) {
              const service = di.get?.(svc);
              if (service) {
                result['di.' + svc] = {
                  type: typeof service,
                  keys: Object.keys(service).slice(0, 15),
                  methods: Object.getOwnPropertyNames(Object.getPrototypeOf(service) || {})
                    .filter(k => typeof service[k] === 'function').slice(0, 15),
                };
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
  console.log("List store info:", JSON.stringify(listStoreInfo.result.value, null, 2));

  console.log("\n=== STEP 5: Explore labels._labels for DRAFT ===\n");

  const labelsDetail = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const labels = ga?.labels;

          if (!labels) return { error: "No labels" };

          const result = {
            labelKeys: Object.keys(labels).slice(0, 30),
          };

          // Check _labels
          if (labels._labels) {
            result._labelsType = typeof labels._labels;
            result._labelsIsMap = labels._labels instanceof Map;

            if (labels._labels instanceof Map) {
              result._labelsSize = labels._labels.size;
              result._labelsKeys = Array.from(labels._labels.keys()).slice(0, 20);

              // Get DRAFT label
              const draftLabel = labels._labels.get('DRAFT');
              if (draftLabel) {
                result.draftLabel = {
                  type: typeof draftLabel,
                  keys: Object.keys(draftLabel).slice(0, 20),
                };
              }
            }
          }

          // Try byId
          if (labels.byId) {
            result.byIdType = typeof labels.byId;
            if (labels.byId instanceof Map) {
              result.byIdKeys = Array.from(labels.byId.keys()).slice(0, 10);
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
  console.log("Labels detail:", JSON.stringify(labelsDetail.result.value, null, 2));

  console.log("\n=== STEP 6: Check if we can get list presenter for DRAFT ===\n");

  const listPresenter = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;

          // Try to get a list presenter for DRAFT
          const result = {};

          // Check cachedMatchers
          if (ga.cachedMatchers) {
            const matchers = ga.cachedMatchers;
            result.matchersType = typeof matchers;
            if (matchers instanceof Map) {
              result.matchersKeys = Array.from(matchers.keys()).slice(0, 20);
              const draftMatcher = matchers.get('DRAFT');
              if (draftMatcher) {
                result.draftMatcher = {
                  type: typeof draftMatcher,
                  keys: Object.keys(draftMatcher).slice(0, 15),
                };
              }
            }
          }

          // Check preloadImportantThreadLists
          if (typeof ga.preloadImportantThreadLists === 'function') {
            result.hasPreloadMethod = true;
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
  console.log("List presenter:", JSON.stringify(listPresenter.result.value, null, 2));

  console.log("\n=== STEP 7: Try to call backend API directly for native drafts ===\n");

  const directApi = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const backend = ga?.backend;
          const credential = ga?.credential;
          const userId = credential?.user?._id;
          const authData = credential?._authData;

          if (!backend || !userId || !authData?.idToken) {
            return { error: "Missing credentials" };
          }

          const result = {
            userId,
            isMicrosoft: !!backend._isMicrosoft,
          };

          // Try readUserData with a path pattern for drafts
          // Superhuman stores drafts at: users/{userId}/threads/{threadId}/messages/{draftId}/draft
          // Let's try to query the drafts prefix
          if (typeof backend.readUserData === 'function') {
            try {
              // Try different path patterns
              const paths = [
                'users/' + userId + '/drafts',
                'users/' + userId + '/messages',
              ];

              for (const path of paths) {
                try {
                  const data = await backend.readUserData([path]);
                  result[path] = {
                    success: true,
                    type: typeof data,
                    keys: typeof data === 'object' ? Object.keys(data || {}).slice(0, 10) : [],
                  };
                } catch (e) {
                  result[path] = { error: e.message.substring(0, 100) };
                }
              }
            } catch (e) {
              result.readUserDataError = e.message;
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
  console.log("Direct API:", JSON.stringify(directApi.result.value, null, 2));
}

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333, false);
  if (!conn) {
    console.error("Failed to connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    process.exit(1);
  }

  console.log("Connected! Exploring portal and backend...\n");

  try {
    await listDraftsViaPortal(conn);
  } finally {
    process.exit(0);
  }
}

main();
