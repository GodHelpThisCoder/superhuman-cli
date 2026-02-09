#!/usr/bin/env bun
/**
 * Explore Native Drafts Storage in Superhuman
 *
 * Investigates where Superhuman stores native drafts (draft00...) for both
 * Gmail and Outlook/Microsoft accounts via CDP.
 *
 * Goal: Find the equivalent of window.GoogleAccount.backend for Outlook accounts.
 */

import { connectToSuperhuman } from "../superhuman-api";

async function exploreNativeDrafts(conn: { Runtime: any }) {
  const { Runtime } = conn;

  console.log("\n=== STEP 1: Check current account type ===\n");

  // First, determine if we're on a Gmail or Outlook account
  const accountType = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          const isMicrosoft = !!di?.get?.('isMicrosoft');
          return {
            email: ga?.emailAddress,
            isMicrosoft,
            hasBackend: !!ga?.backend,
            hasCredential: !!ga?.credential,
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("Account info:", JSON.stringify(accountType.result.value, null, 2));

  console.log("\n=== STEP 2: Explore window.GoogleAccount structure ===\n");

  // Explore the GoogleAccount object keys (works for both Gmail and Outlook)
  const gaKeys = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          if (!ga) return { error: "No GoogleAccount" };

          const topKeys = Object.keys(ga).slice(0, 50);
          const protoMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(ga) || {})
            .filter(k => typeof ga[k] === 'function').slice(0, 50);

          return { topKeys, protoMethods };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("GoogleAccount keys:", JSON.stringify(gaKeys.result.value, null, 2));

  console.log("\n=== STEP 3: Explore backend object (if exists) ===\n");

  const backendInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const backend = window.GoogleAccount?.backend;
          if (!backend) return { error: "No backend object" };

          const backendKeys = Object.keys(backend).slice(0, 100);
          const backendMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(backend) || {})
            .filter(k => typeof backend[k] === 'function').slice(0, 100);

          return { backendKeys, backendMethods };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("Backend info:", JSON.stringify(backendInfo.result.value, null, 2));

  console.log("\n=== STEP 4: Check for drafts-related methods/properties ===\n");

  const draftsInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const backend = ga?.backend;
          const di = ga?.di;

          const result = {
            backendDraftMethods: [],
            diDraftServices: [],
            draftController: null,
          };

          // Check backend for draft-related methods
          if (backend) {
            const protoMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(backend) || {});
            result.backendDraftMethods = protoMethods.filter(m =>
              m.toLowerCase().includes('draft') ||
              m.toLowerCase().includes('message') ||
              m.toLowerCase().includes('thread')
            );
          }

          // Check DI container for draft-related services
          if (di) {
            // Try to get draft controller
            try {
              const draftController = di.get?.('DraftController');
              if (draftController) {
                result.draftController = {
                  type: typeof draftController,
                  keys: Object.keys(draftController).slice(0, 30),
                  methods: Object.getOwnPropertyNames(Object.getPrototypeOf(draftController) || {})
                    .filter(k => typeof draftController[k] === 'function').slice(0, 30),
                };
              }
            } catch (_) {}
          }

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("Drafts-related info:", JSON.stringify(draftsInfo.result.value, null, 2));

  console.log("\n=== STEP 5: Try to list native drafts ===\n");

  // Try to get native drafts from various sources
  const nativeDrafts = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const backend = ga?.backend;
          const di = ga?.di;

          const result = {
            draftCount: 0,
            sampleDrafts: [],
            method: null,
          };

          // Method 1: Try backend._drafts or backend.drafts
          if (backend) {
            const drafts = backend._drafts || backend.drafts;
            if (drafts) {
              result.method = "backend._drafts or backend.drafts";
              if (drafts instanceof Map) {
                result.draftCount = drafts.size;
                const entries = Array.from(drafts.entries()).slice(0, 3);
                result.sampleDrafts = entries.map(([k, v]) => ({
                  id: k,
                  keys: Object.keys(v || {}).slice(0, 10),
                }));
              } else if (typeof drafts === 'object') {
                const keys = Object.keys(drafts);
                result.draftCount = keys.length;
                result.sampleDrafts = keys.slice(0, 3).map(k => ({
                  id: k,
                  keys: Object.keys(drafts[k] || {}).slice(0, 10),
                }));
              }
            }
          }

          // Method 2: Try DraftController
          if (di && result.draftCount === 0) {
            try {
              const dc = di.get?.('DraftController');
              if (dc) {
                const drafts = dc._drafts || dc.drafts || dc.allDrafts?.();
                if (drafts) {
                  result.method = "DraftController";
                  if (drafts instanceof Map) {
                    result.draftCount = drafts.size;
                    const entries = Array.from(drafts.entries()).slice(0, 3);
                    result.sampleDrafts = entries.map(([k, v]) => ({
                      id: k,
                      keys: Object.keys(v || {}).slice(0, 10),
                    }));
                  } else if (Array.isArray(drafts)) {
                    result.draftCount = drafts.length;
                    result.sampleDrafts = drafts.slice(0, 3).map(d => ({
                      id: d.id || 'unknown',
                      keys: Object.keys(d || {}).slice(0, 10),
                    }));
                  }
                }
              }
            } catch (_) {}
          }

          return result;
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("Native drafts:", JSON.stringify(nativeDrafts.result.value, null, 2));

  console.log("\n=== STEP 6: Explore userdata for draft threads ===\n");

  // Check if there's userdata that contains draft threads
  const userdataInfo = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const backend = ga?.backend;

          if (!backend) return { error: "No backend" };

          // Look for userdata or data stores
          const possibleStores = ['_userdata', 'userdata', '_data', 'data', '_threadStore', 'threadStore', '_messages'];
          const result = {};

          for (const store of possibleStores) {
            if (backend[store]) {
              const val = backend[store];
              result[store] = {
                type: typeof val,
                isMap: val instanceof Map,
                keys: val instanceof Map ? Array.from(val.keys()).slice(0, 10) : Object.keys(val || {}).slice(0, 10),
              };
            }
          }

          // Also check for methods that might return drafts
          const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(backend) || {});
          const draftMethods = methods.filter(m =>
            m.toLowerCase().includes('draft') ||
            m.toLowerCase().includes('getdraft') ||
            m.toLowerCase().includes('listdraft')
          );
          result.draftMethods = draftMethods;

          return result;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("Userdata info:", JSON.stringify(userdataInfo.result.value, null, 2));

  console.log("\n=== STEP 7: Check for MicrosoftAccount or alternate global ===\n");

  // Check if there's a separate MicrosoftAccount global
  const altGlobals = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const result = {
            hasMicrosoftAccount: !!window.MicrosoftAccount,
            hasOutlookAccount: !!window.OutlookAccount,
            hasAccount: !!window.Account,
            hasCurrentAccount: !!window.currentAccount,
            googleAccountType: typeof window.GoogleAccount,
          };

          // Check if GoogleAccount has any Microsoft-specific properties
          const ga = window.GoogleAccount;
          if (ga) {
            const di = ga.di;
            if (di) {
              result.diIsMicrosoft = !!di.get?.('isMicrosoft');
              result.diMsGraph = !!di.get?.('msGraph');
              result.diGraph = !!di.get?.('graph');

              // List all DI service names
              try {
                const registry = di._registry || di.registry;
                if (registry) {
                  const keys = registry instanceof Map
                    ? Array.from(registry.keys()).slice(0, 50)
                    : Object.keys(registry).slice(0, 50);
                  result.diServices = keys;
                }
              } catch (_) {}
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
  console.log("Alternative globals:", JSON.stringify(altGlobals.result.value, null, 2));

  console.log("\n=== STEP 8: Check userdata path structure (Superhuman backend API) ===\n");

  // The Superhuman backend uses paths like users/{userId}/threads/{threadId}/messages/{draftId}/draft
  const userPath = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const credential = ga?.credential;
          const user = credential?.user;

          return {
            userId: user?._id,
            email: ga?.emailAddress,
            hasUserdata: !!ga?.backend?._userdata,
            userdataType: typeof ga?.backend?._userdata,
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });
  console.log("User path info:", JSON.stringify(userPath.result.value, null, 2));
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
    await exploreNativeDrafts(conn);
  } finally {
    process.exit(0);
  }
}

main();
