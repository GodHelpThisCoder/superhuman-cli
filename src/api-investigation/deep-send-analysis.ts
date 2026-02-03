#!/usr/bin/env bun
/**
 * Deep Send Analysis
 *
 * Analyze the complete send flow to understand how to send programmatically.
 */

import { connectToSuperhuman } from "../superhuman-api";

async function analyzeSaveDraftFlow(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          // Find the saveDraft static method
          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const ctrl = cfc?.[draftKey];

          if (!ctrl) return { error: "No controller found" };

          // Get the class
          const CtrlClass = ctrl.constructor;

          // Look for static saveDraft
          if (typeof CtrlClass.saveDraft === 'function') {
            return {
              hasSaveDraft: true,
              saveDraftSource: CtrlClass.saveDraft.toString().substring(0, 3000),
            };
          }

          return { error: "No static saveDraft found" };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function analyzeDraftJson(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const ctrl = cfc?.[draftKey];
          const draft = ctrl?.state?.draft;

          if (!draft) return { error: "No draft found" };

          // Get the json method source
          const jsonSource = draft.json?.toString().substring(0, 2000);

          // Try calling json()
          let jsonResult = null;
          try {
            jsonResult = draft.json();
          } catch (e) {
            jsonResult = { error: e.message };
          }

          // Check asMessage
          let asMessageSource = null;
          if (typeof draft.asMessage === 'function') {
            asMessageSource = draft.asMessage.toString().substring(0, 1500);
          }

          return {
            jsonSource,
            jsonResult,
            asMessageSource,
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function analyzeAsMessage(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const ctrl = cfc?.[draftKey];
          const draft = ctrl?.state?.draft;

          if (!draft) return { error: "No draft found" };

          // Call asMessage to get the message object
          const msg = draft.asMessage();
          if (!msg) return { error: "asMessage returned null" };

          const info = {
            msgType: msg.constructor?.name,
            msgKeys: Object.keys(msg).slice(0, 30),
            msgMethods: [],
          };

          // Get methods
          let proto = Object.getPrototypeOf(msg);
          while (proto && proto !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(proto)) {
              if (typeof msg[name] === 'function') {
                info.msgMethods.push(name);
              }
            }
            proto = Object.getPrototypeOf(proto);
          }

          // Look for toJsonRequest
          if (typeof msg.toJsonRequest === 'function') {
            info.hasToJsonRequest = true;
            info.toJsonRequestSource = msg.toJsonRequest.toString().substring(0, 2000);

            // Try to call it
            try {
              info.jsonRequest = msg.toJsonRequest();
            } catch (e) {
              info.jsonRequestError = e.message;
            }
          }

          // Look for toJson
          if (typeof msg.toJson === 'function') {
            info.hasToJson = true;
            try {
              info.toJson = msg.toJson();
            } catch (e) {
              info.toJsonError = e.message;
            }
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

async function trySendViaBackend(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Try to construct and send a message via backend.sendEmail
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const backend = ga?.backend;

          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const ctrl = cfc?.[draftKey];
          const draft = ctrl?.state?.draft;

          if (!draft) return { error: "No draft found - open compose first" };
          if (!backend) return { error: "No backend" };

          // Get the message object
          const msg = draft.asMessage();
          if (!msg) return { error: "asMessage failed" };

          // Check if it has toJsonRequest
          if (typeof msg.toJsonRequest !== 'function') {
            return {
              error: "No toJsonRequest method",
              msgMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(msg))
                .filter(k => typeof msg[k] === 'function'),
            };
          }

          // Get the JSON request payload
          const jsonReq = msg.toJsonRequest();

          return {
            success: true,
            msgType: msg.constructor?.name,
            jsonRequestKeys: Object.keys(jsonReq),
            jsonRequest: JSON.stringify(jsonReq).substring(0, 2000),
            // DO NOT ACTUALLY SEND - just return the payload we would send
          };
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

async function analyzeMessageModel(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const ctrl = cfc?.[draftKey];
          const draft = ctrl?.state?.draft;

          if (!draft) return { error: "No draft found" };

          const msg = draft.asMessage();
          if (!msg) return { error: "No message" };

          // Get the Message class
          const MsgClass = msg.constructor;

          return {
            msgClassName: MsgClass.name,
            constructorLength: MsgClass.length,
            // Get the constructor source to understand required params
            constructorSource: MsgClass.toString().substring(0, 3000),
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function analyzeFullSendPath(conn: { Runtime: any }) {
  const { Runtime } = conn;

  // Trace through the entire send path
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc || {}).find(k => k.startsWith('draft'));
          const ctrl = cfc?.[draftKey];

          if (!ctrl) return { error: "No controller" };

          // Get the props to understand what's available
          const props = ctrl.props;

          return {
            propsKeys: Object.keys(props || {}).slice(0, 30),
            hasAccount: !!props?.account,
            hasThread: !!props?.thread,
            hasRun: typeof props?.run === 'function',

            // Check what actions are available
            actionsAvailable: props?.actions ? Object.keys(props.actions) : [],
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function main() {
  console.log("Deep Send Analysis");
  console.log("=".repeat(60));
  console.log("");

  const conn = await connectToSuperhuman();
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  console.log("Connected to Superhuman\n");

  try {
    // 1. Analyze saveDraft flow
    console.log("1. Static saveDraft Method");
    console.log("-".repeat(40));
    const saveFlow = await analyzeSaveDraftFlow(conn);
    console.log(saveFlow.saveDraftSource?.substring(0, 1500) || saveFlow.error);
    console.log("");

    // 2. Analyze draft.json()
    console.log("2. Draft JSON Methods");
    console.log("-".repeat(40));
    const draftJson = await analyzeDraftJson(conn);
    console.log("json() result:", JSON.stringify(draftJson.jsonResult, null, 2)?.substring(0, 1000));
    console.log("");

    // 3. Analyze asMessage
    console.log("3. AsMessage Analysis");
    console.log("-".repeat(40));
    const asMsg = await analyzeAsMessage(conn);
    console.log(JSON.stringify(asMsg, null, 2));
    console.log("");

    // 4. Analyze Message model
    console.log("4. Message Model Class");
    console.log("-".repeat(40));
    const msgModel = await analyzeMessageModel(conn);
    console.log("Class name:", msgModel.msgClassName);
    console.log("Constructor args:", msgModel.constructorLength);
    console.log("\nConstructor source:");
    console.log(msgModel.constructorSource?.substring(0, 1000));
    console.log("");

    // 5. Try to construct send payload
    console.log("5. Backend Send Payload");
    console.log("-".repeat(40));
    const sendPayload = await trySendViaBackend(conn);
    console.log(JSON.stringify(sendPayload, null, 2));
    console.log("");

    // 6. Full send path
    console.log("6. Controller Props");
    console.log("-".repeat(40));
    const sendPath = await analyzeFullSendPath(conn);
    console.log(JSON.stringify(sendPath, null, 2));

  } finally {
    await conn.client.close();
    console.log("\nDisconnected from Superhuman");
  }
}

main().catch(console.error);
