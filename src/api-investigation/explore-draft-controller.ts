/**
 * Explore Superhuman's Draft Controller via CDP
 *
 * Investigate how drafts are created/saved internally to understand
 * the CDP-based approach for creating drafts.
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  console.log("Connecting to Superhuman...\n");

  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const { Runtime } = conn;

  // Step 1: Check ViewState structure
  console.log("=== Step 1: ViewState Structure ===\n");

  const viewStateResult = await Runtime.evaluate({
    expression: `
      (() => {
        const vs = window.ViewState;
        if (!vs) return { error: "ViewState not found" };

        return {
          hasComposeFormController: !!vs._composeFormController,
          composeControllerKeys: vs._composeFormController ? Object.keys(vs._composeFormController) : [],
          hasOpenCompose: typeof vs.openCompose === 'function',
          hasCreateDraft: typeof vs.createDraft === 'function',
          methods: Object.keys(vs).filter(k => typeof vs[k] === 'function').slice(0, 20)
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("ViewState:", JSON.stringify(viewStateResult.result.value, null, 2));

  // Step 2: Check GoogleAccount.draftStore
  console.log("\n=== Step 2: GoogleAccount Draft Store ===\n");

  const draftStoreResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga) return { error: "GoogleAccount not found" };

        // Check for draft-related stores
        const stores = {};
        const checkNames = ['draftStore', 'drafts', '_drafts', 'draftManager', 'composeStore'];

        for (const name of checkNames) {
          if (ga[name]) {
            stores[name] = {
              type: typeof ga[name],
              methods: typeof ga[name] === 'object' ?
                Object.keys(ga[name]).filter(k => typeof ga[name][k] === 'function').slice(0, 10) : [],
              properties: typeof ga[name] === 'object' ?
                Object.keys(ga[name]).filter(k => typeof ga[name][k] !== 'function').slice(0, 10) : []
            };
          }
        }

        // Check DI container for draft services
        const di = ga.di;
        if (di && typeof di.get === 'function') {
          const diNames = ['DraftStore', 'DraftService', 'DraftManager', 'ComposeService'];
          for (const name of diNames) {
            try {
              const service = di.get(name);
              if (service) {
                stores['di.' + name] = {
                  type: typeof service,
                  methods: typeof service === 'object' ?
                    Object.keys(service).filter(k => typeof service[k] === 'function').slice(0, 10) : []
                };
              }
            } catch {}
          }
        }

        return stores;
      })()
    `,
    returnByValue: true,
  });
  console.log("Draft Stores:", JSON.stringify(draftStoreResult.result.value, null, 2));

  // Step 3: If there's an open compose, inspect it
  console.log("\n=== Step 3: Open Compose Controller ===\n");

  const composeResult = await Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "No compose form controller" };

        const keys = Object.keys(cfc);
        if (keys.length === 0) return { message: "No open compose windows" };

        const results = {};
        for (const key of keys) {
          const ctrl = cfc[key];
          results[key] = {
            hasState: !!ctrl?.state,
            hasDraft: !!ctrl?.state?.draft,
            draftId: ctrl?.state?.draft?.id,
            draftSubject: ctrl?.state?.draft?.subject,
            methods: ctrl ? Object.keys(ctrl).filter(k => typeof ctrl[k] === 'function').slice(0, 15) : [],
            stateKeys: ctrl?.state ? Object.keys(ctrl.state).slice(0, 15) : []
          };
        }
        return results;
      })()
    `,
    returnByValue: true,
  });
  console.log("Compose Controllers:", JSON.stringify(composeResult.result.value, null, 2));

  // Step 4: Check how to open compose programmatically
  console.log("\n=== Step 4: Compose Trigger Methods ===\n");

  const triggerResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const vs = window.ViewState;

        const triggers = {};

        // Check for compose trigger on ViewState
        if (vs) {
          triggers.viewState = {
            openCompose: typeof vs.openCompose,
            newCompose: typeof vs.newCompose,
            compose: typeof vs.compose,
            createDraft: typeof vs.createDraft
          };
        }

        // Check for compose on GoogleAccount
        if (ga) {
          triggers.googleAccount = {
            openCompose: typeof ga.openCompose,
            createDraft: typeof ga.createDraft,
            newMessage: typeof ga.newMessage
          };
        }

        // Check for ComposeService in DI
        try {
          const composeService = ga?.di?.get?.('ComposeService');
          if (composeService) {
            triggers.composeService = {
              methods: Object.keys(composeService).filter(k => typeof composeService[k] === 'function')
            };
          }
        } catch {}

        // Check for actions
        try {
          const actions = ga?.di?.get?.('Actions');
          if (actions) {
            triggers.actions = {
              compose: typeof actions.compose,
              newDraft: typeof actions.newDraft,
              openCompose: typeof actions.openCompose
            };
          }
        } catch {}

        return triggers;
      })()
    `,
    returnByValue: true,
  });
  console.log("Compose Triggers:", JSON.stringify(triggerResult.result.value, null, 2));

  // Step 5: Check Gmail service for direct draft creation
  console.log("\n=== Step 5: Gmail Service Draft Methods ===\n");

  const gmailResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const gmail = ga?.gmail || ga?.di?.get?.('GmailService') || ga?.di?.get?.('gmail');

        if (!gmail) return { error: "Gmail service not found" };

        const methods = Object.keys(gmail).filter(k => typeof gmail[k] === 'function');
        const draftMethods = methods.filter(m =>
          m.toLowerCase().includes('draft') ||
          m.toLowerCase().includes('compose') ||
          m.toLowerCase().includes('message')
        );

        return {
          allMethods: methods.slice(0, 30),
          draftMethods: draftMethods,
          hasPostAsync: typeof gmail._postAsync === 'function',
          hasPutAsync: typeof gmail._putAsync === 'function'
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("Gmail Service:", JSON.stringify(gmailResult.result.value, null, 2));

  await disconnect(conn);
  console.log("\nDone.");
}

main().catch(console.error);
