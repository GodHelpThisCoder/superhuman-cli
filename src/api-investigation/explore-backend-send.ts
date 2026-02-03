#!/usr/bin/env bun
/**
 * Explore Backend Send API
 *
 * Investigates how to use Superhuman's backend.sendEmail() method
 * which might be preferable to direct Gmail API calls.
 */

import { connectToSuperhuman } from "../superhuman-api";

async function analyzeMessageClass(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          // Find the Message class used by sendEmail
          // The backend.sendEmail expects r.toJsonRequest()

          // Look for a Message or OutgoingMessage class
          const ga = window.GoogleAccount;
          const di = ga?.di;

          const info = {
            diKeys: [],
          };

          // Check what's in DI
          if (di?._bindings) {
            info.diKeys = Array.from(di._bindings.keys?.() || []);
          }

          // Look for message-related items
          const searchKeys = ['message', 'draft', 'outgoing', 'compose', 'send'];
          for (const key of searchKeys) {
            try {
              const item = di?.get?.(key);
              if (item) {
                info[key] = {
                  type: typeof item,
                  constructor: item.constructor?.name,
                  keys: Object.keys(item).slice(0, 20),
                };
              }
            } catch (e) {}
          }

          // Check the drafts service
          const drafts = di?.get?.('drafts');
          if (drafts) {
            info.draftsService = {
              type: typeof drafts,
              constructor: drafts.constructor?.name,
              methods: Object.getOwnPropertyNames(Object.getPrototypeOf(drafts))
                .filter(k => typeof drafts[k] === 'function'),
            };
          }

          return info;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function analyzeOutgoingMessage(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Try to find how outgoing messages are created
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          // Look at how the compose form creates messages
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return { error: "No compose form controller" };

          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return { error: "No draft found" };

          const ctrl = cfc[draftKey];
          const draft = ctrl?.state?.draft;

          if (!draft) return { error: "No draft object" };

          const info = {
            draftType: draft.constructor?.name,
            draftKeys: Object.keys(draft).slice(0, 30),
            draftProtoMethods: [],
          };

          // Get prototype methods
          let proto = Object.getPrototypeOf(draft);
          while (proto && proto !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(proto)) {
              if (typeof draft[name] === 'function') {
                info.draftProtoMethods.push(name);
              }
            }
            proto = Object.getPrototypeOf(proto);
          }

          // Look for serialization methods
          const serializeMethods = info.draftProtoMethods.filter(m =>
            m.includes('Json') || m.includes('json') ||
            m.includes('Serialize') || m.includes('serialize') ||
            m.includes('Request') || m.includes('request')
          );
          info.serializeMethods = serializeMethods;

          // Try to get the toJsonRequest method
          if (typeof draft.toJsonRequest === 'function') {
            info.toJsonRequestSource = draft.toJsonRequest.toString().substring(0, 1500);
          }

          // Try to get toJson
          if (typeof draft.toJson === 'function') {
            info.toJsonSource = draft.toJson.toString().substring(0, 1500);
          }

          return info;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function createTestMessage(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Try to create a message object programmatically
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          // First, open a compose to get access to the draft class
          // We'll look at an existing draft structure

          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return { error: "No compose controller" };

          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return { error: "No draft - need to open compose first" };

          const ctrl = cfc[draftKey];
          const draft = ctrl?.state?.draft;

          if (!draft) return { error: "No draft object" };

          // Get the draft class
          const DraftClass = draft.constructor;

          // See what the current draft looks like in JSON form
          let jsonRequest = null;
          if (typeof draft.toJsonRequest === 'function') {
            try {
              jsonRequest = draft.toJsonRequest();
            } catch (e) {
              jsonRequest = { error: e.message };
            }
          }

          // See what toJson looks like
          let json = null;
          if (typeof draft.toJson === 'function') {
            try {
              json = draft.toJson();
            } catch (e) {
              json = { error: e.message };
            }
          }

          return {
            draftClass: DraftClass.name,
            currentDraftJson: json,
            currentDraftJsonRequest: jsonRequest,
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value;
}

async function analyzeCtrlSend(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Analyze how _sendDraft actually works
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return { error: "No compose controller" };

          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return { error: "No draft - need to open compose first" };

          const ctrl = cfc[draftKey];

          const info = {
            ctrlType: ctrl.constructor?.name,
            ctrlMethods: [],
          };

          // Get all methods
          let proto = Object.getPrototypeOf(ctrl);
          while (proto && proto !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(proto)) {
              if (typeof ctrl[name] === 'function') {
                info.ctrlMethods.push(name);
              }
            }
            proto = Object.getPrototypeOf(proto);
          }

          // Get _sendDraft source
          if (typeof ctrl._sendDraft === 'function') {
            info._sendDraftSource = ctrl._sendDraft.toString().substring(0, 2000);
          }

          // Get _saveDraftAsync source
          if (typeof ctrl._saveDraftAsync === 'function') {
            info._saveDraftAsyncSource = ctrl._saveDraftAsync.toString().substring(0, 2000);
          }

          return info;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function findDraftModel(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Look for the Draft model class
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          // Check if there's a global Draft class
          const possibleClasses = [
            'Draft', 'Message', 'OutgoingMessage', 'Email',
            'DraftMessage', 'ComposeMessage', 'SendMessage'
          ];

          const found = {};
          for (const name of possibleClasses) {
            if (window[name]) {
              found[name] = {
                type: typeof window[name],
                isFunction: typeof window[name] === 'function',
              };
            }
          }

          // Check in GoogleAccount
          const ga = window.GoogleAccount;
          if (ga) {
            for (const key of Object.keys(ga).slice(0, 50)) {
              const val = ga[key];
              if (typeof val === 'function' && val.name &&
                  (val.name.includes('Draft') || val.name.includes('Message'))) {
                found['ga.' + key] = {
                  constructorName: val.name,
                };
              }
            }
          }

          return found;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function tryCreateDraftProgrammatically(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const backend = ga?.backend;
          const di = ga?.di;

          if (!backend) return { error: "backend not found" };

          // Get a reference draft to understand structure
          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const refCtrl = cfc?.[draftKey];
          const refDraft = refCtrl?.state?.draft;

          if (!refDraft) {
            return { error: "No reference draft found - open compose first" };
          }

          // Get the Draft constructor
          const DraftClass = refDraft.constructor;

          // Look at what arguments the constructor takes
          const info = {
            constructorLength: DraftClass.length,
            constructorSource: DraftClass.toString().substring(0, 1000),
          };

          // Try to create a minimal draft
          // Looking at how the compose form initializes drafts

          // Check if there's a factory method
          if (refCtrl.createDraft) {
            info.hasCreateDraft = true;
            info.createDraftSource = refCtrl.createDraft.toString().substring(0, 500);
          }

          // Look for draft factory in DI
          const draftFactory = di?.get?.('draftFactory');
          if (draftFactory) {
            info.hasDraftFactory = true;
            info.factoryMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(draftFactory))
              .filter(k => typeof draftFactory[k] === 'function');
          }

          return info;
        } catch (e) {
          return { error: e.message, stack: e.stack?.substring(0, 500) };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value;
}

async function main() {
  console.log("Explore Backend Send API");
  console.log("=".repeat(60));
  console.log("");

  const conn = await connectToSuperhuman();
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  console.log("Connected to Superhuman\n");

  try {
    // 1. Analyze DI container
    console.log("1. DI Container Analysis");
    console.log("-".repeat(40));
    const diInfo = await analyzeMessageClass(conn);
    console.log(JSON.stringify(diInfo, null, 2));
    console.log("");

    // 2. Find Draft model
    console.log("2. Find Draft Model Class");
    console.log("-".repeat(40));
    const modelInfo = await findDraftModel(conn);
    console.log(JSON.stringify(modelInfo, null, 2));
    console.log("");

    // 3. Analyze outgoing message
    console.log("3. Analyze Outgoing Message Structure");
    console.log("-".repeat(40));
    const msgInfo = await analyzeOutgoingMessage(conn);
    console.log(JSON.stringify(msgInfo, null, 2));
    console.log("");

    // 4. Create test message
    console.log("4. Analyze Current Draft");
    console.log("-".repeat(40));
    const testMsg = await createTestMessage(conn);
    console.log(JSON.stringify(testMsg, null, 2));
    console.log("");

    // 5. Analyze _sendDraft
    console.log("5. Analyze _sendDraft Method");
    console.log("-".repeat(40));
    const sendInfo = await analyzeCtrlSend(conn);
    console.log("_sendDraft source:");
    console.log(sendInfo._sendDraftSource || "(not found)");
    console.log("");

    // 6. Try to create draft programmatically
    console.log("6. Draft Creation Analysis");
    console.log("-".repeat(40));
    const draftCreate = await tryCreateDraftProgrammatically(conn);
    console.log(JSON.stringify(draftCreate, null, 2));
    console.log("");

  } finally {
    await conn.client.close();
    console.log("\nDisconnected from Superhuman");
  }
}

main().catch(console.error);
