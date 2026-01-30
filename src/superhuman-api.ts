/**
 * Superhuman Internal API Wrapper
 *
 * This module provides programmatic access to Superhuman's internal APIs
 * via Chrome DevTools Protocol (CDP) for automating email composition,
 * draft management, and sending.
 *
 * Key findings from reverse engineering:
 *
 * 1. Compose form is accessed via ViewState._composeFormController
 * 2. Each compose has a draft key like "draft00c0820cca54b14a"
 * 3. The controller has methods: setSubject, getEditor, _updateDraft, _saveDraftAsync, _sendDraft
 * 4. Recipients are class instances that need proper constructor
 * 5. Full compose must be opened by clicking .ThreadListView-compose
 */

import CDP from "chrome-remote-interface";

export interface SuperhumanConnection {
  client: CDP.Client;
  Runtime: CDP.Client["Runtime"];
  Input: CDP.Client["Input"];
  Network: CDP.Client["Network"];
}

export interface DraftState {
  id: string;
  subject: string;
  body: string;
  to: string[];
  cc: string[];
  bcc: string[];
  from: string;
  isDirty: boolean;
}

/**
 * Find and connect to the Superhuman main page via CDP
 */
export async function connectToSuperhuman(
  port = 9333
): Promise<SuperhumanConnection | null> {
  const targets = await CDP.List({ port });

  const mainPage = targets.find(
    (t) =>
      t.url.includes("mail.superhuman.com") &&
      !t.url.includes("background") &&
      !t.url.includes("serviceworker") &&
      t.type === "page"
  );

  if (!mainPage) {
    console.error("Could not find Superhuman main page");
    return null;
  }

  const client = await CDP({ target: mainPage.id, port });
  return {
    client,
    Runtime: client.Runtime,
    Input: client.Input,
    Network: client.Network,
  };
}

/**
 * Open the full compose form by clicking ThreadListView-compose
 */
export async function openCompose(conn: SuperhumanConnection): Promise<string | null> {
  const { Runtime, Input } = conn;

  // Close any existing compose first
  await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });
  await new Promise((r) => setTimeout(r, 500));

  // Click the compose area to open full compose
  await Runtime.evaluate({
    expression: `document.querySelector('.ThreadListView-compose')?.click()`,
  });
  await new Promise((r) => setTimeout(r, 2000));

  // Get the draft key
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return null;
          const keys = Object.keys(cfc);
          return keys.find(k => k.startsWith('draft')) || null;
        } catch (e) {
          return null;
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value as string | null;
}

/**
 * Get current draft state
 */
export async function getDraftState(
  conn: SuperhumanConnection
): Promise<DraftState | null> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return null;
          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return null;
          const ctrl = cfc[draftKey];
          const draft = ctrl?.state?.draft;
          if (!draft) return null;
          return {
            id: draft.id,
            subject: draft.subject || draft.getSubject?.() || '',
            body: draft.body || draft.getBody?.() || '',
            to: (draft.to || draft.getTo?.() || []).map(r => r.email),
            cc: (draft.cc || draft.getCc?.() || []).map(r => r.email),
            bcc: (draft.bcc || draft.getBcc?.() || []).map(r => r.email),
            from: draft.from?.email || '',
            isDirty: draft.dirty || false,
          };
        } catch (e) {
          return null;
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value as DraftState | null;
}

/**
 * Set the subject of the current draft using the controller method
 */
export async function setSubject(
  conn: SuperhumanConnection,
  subject: string
): Promise<boolean> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return false;
          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return false;
          const ctrl = cfc[draftKey];
          if (!ctrl || typeof ctrl.setSubject !== 'function') return false;
          ctrl.setSubject(${JSON.stringify(subject)});
          return true;
        } catch (e) {
          return false;
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value === true;
}

/**
 * Add a recipient to the To field using the internal API
 * Creates a proper recipient object using the same constructor as from field
 */
export async function addRecipient(
  conn: SuperhumanConnection,
  email: string,
  name?: string
): Promise<boolean> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return false;
          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return false;
          const ctrl = cfc[draftKey];
          const draft = ctrl?.state?.draft;
          if (!draft?.from?.constructor) return false;

          // Create recipient using the same constructor as the from field
          const Recipient = draft.from.constructor;
          const newRecipient = new Recipient({
            email: ${JSON.stringify(email)},
            name: ${JSON.stringify(name || "")},
            raw: ${JSON.stringify(name ? `${name} <${email}>` : email)},
          });

          // Get existing recipients and add new one
          const existingTo = draft.to || [];
          ctrl._updateDraft({ to: [...existingTo, newRecipient] });
          return true;
        } catch (e) {
          console.error('addRecipient error:', e);
          return false;
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value === true;
}

/**
 * Set the body of the current draft using _updateDraft
 * Note: This sets the draft body but doesn't update the visual editor.
 * The body content is saved when _saveDraftAsync is called.
 */
export async function setBody(
  conn: SuperhumanConnection,
  html: string
): Promise<boolean> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return false;
          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return false;
          const ctrl = cfc[draftKey];
          if (!ctrl || typeof ctrl._updateDraft !== 'function') return false;
          ctrl._updateDraft({ body: ${JSON.stringify(html)} });
          return true;
        } catch (e) {
          return false;
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value === true;
}

/**
 * Save the current draft using the internal _saveDraftAsync method
 */
export async function saveDraft(conn: SuperhumanConnection): Promise<boolean> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return false;
          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return false;
          const ctrl = cfc[draftKey];
          if (!ctrl || typeof ctrl._saveDraftAsync !== 'function') return false;
          ctrl._saveDraftAsync();
          return true;
        } catch (e) {
          return false;
        }
      })()
    `,
    returnByValue: true,
  });

  // Wait for save to complete
  await new Promise((r) => setTimeout(r, 2000));

  return result.result.value === true;
}

/**
 * Close the compose form
 */
export async function closeCompose(conn: SuperhumanConnection): Promise<void> {
  const { Input } = conn;

  await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape" });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape" });
  await new Promise((r) => setTimeout(r, 500));
}

/**
 * Disconnect from Superhuman
 */
export async function disconnect(conn: SuperhumanConnection): Promise<void> {
  await conn.client.close();
}

// Main test function
async function main() {
  console.log("=== Superhuman API Test ===\n");

  const conn = await connectToSuperhuman();
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    return;
  }

  console.log("Connected to Superhuman");

  // Open compose
  const draftKey = await openCompose(conn);
  console.log("Opened compose:", draftKey);

  if (!draftKey) {
    console.error("Failed to open compose");
    await disconnect(conn);
    return;
  }

  // Get initial state
  let state = await getDraftState(conn);
  console.log("\nInitial draft state:", state);

  // Add recipient
  console.log("\nAdding recipient...");
  await addRecipient(conn, "eddyhu@gmail.com");

  // Set subject
  console.log("Setting subject...");
  await setSubject(conn, "CLI API Test: " + new Date().toISOString().slice(0, 19));

  // Set body
  console.log("Setting body...");
  await setBody(conn, "<p>Hello from the Superhuman CLI API!</p><p>This email was composed programmatically.</p>");

  // Get updated state
  state = await getDraftState(conn);
  console.log("\nUpdated draft state:", state);

  // Save draft
  console.log("\nSaving draft...");
  await saveDraft(conn);

  // Final state
  state = await getDraftState(conn);
  console.log("\nFinal draft state:", state);

  console.log("\n=== Test complete ===");
  console.log("(Compose left open for inspection)");

  await disconnect(conn);
}

// Run if executed directly
if (import.meta.main) {
  main().catch(console.error);
}
