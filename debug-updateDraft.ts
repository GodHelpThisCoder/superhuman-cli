
import { connectToSuperhuman, disconnect, openCompose } from "./src/superhuman-api";

async function debugUpdateDraft() {
  console.log("=== DEBUG: _updateDraft Behavior ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  // Open compose
  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose, draftKey: "${draftKey}"`);

  // Test what methods exist and their behavior
  const testResult = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "No cfc" };

        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];
        if (!ctrl) return { error: "No controller for key: " + draftKey };

        // Check what methods exist
        const methods = {
          setSubject: typeof ctrl.setSubject,
          _updateDraft: typeof ctrl._updateDraft,
          _saveDraftAsync: typeof ctrl._saveDraftAsync,
          _sendDraft: typeof ctrl._sendDraft,
        };

        // Check the draft object structure
        const draft = ctrl.state?.draft;
        const draftStructure = draft ? {
          hasTo: Array.isArray(draft.to),
          hasCc: Array.isArray(draft.cc),
          hasBcc: Array.isArray(draft.bcc),
          hasBody: typeof draft.body,
          hasSubject: typeof draft.subject,
          hasFrom: !!draft.from,
          fromConstructor: draft.from?.constructor?.name,
        } : null;

        // Try calling _updateDraft directly and check result
        const beforeBody = draft?.body;
        const beforeSubject = draft?.subject;
        const beforeTo = (draft?.to || []).map(r => r.email);

        // First, let's try setSubject
        let setSubjectResult = null;
        try {
          ctrl.setSubject("Test Subject Direct");
          setSubjectResult = "called without error";
        } catch (e) {
          setSubjectResult = "error: " + e.message;
        }

        // Check if subject changed
        const afterSetSubject = draft?.subject;

        // Now try _updateDraft for body
        let updateBodyResult = null;
        try {
          ctrl._updateDraft({ body: "<p>Test body direct</p>" });
          updateBodyResult = "called without error";
        } catch (e) {
          updateBodyResult = "error: " + e.message;
        }

        // Check if body changed
        const afterUpdateBody = draft?.body;

        // Try adding a recipient
        let addRecipientResult = null;
        try {
          if (draft?.from?.constructor) {
            const Recipient = draft.from.constructor;
            const newR = new Recipient({ email: "direct@test.com", name: "", raw: "direct@test.com" });
            ctrl._updateDraft({ to: [...(draft.to || []), newR] });
            addRecipientResult = "called without error";
          } else {
            addRecipientResult = "no from.constructor";
          }
        } catch (e) {
          addRecipientResult = "error: " + e.message;
        }

        const afterAddRecipient = (draft?.to || []).map(r => r.email);

        return {
          draftKey,
          methods,
          draftStructure,
          beforeBody,
          beforeSubject,
          beforeTo,
          setSubjectResult,
          afterSetSubject,
          updateBodyResult,
          afterUpdateBody,
          addRecipientResult,
          afterAddRecipient,
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("2. Test results:");
  console.log(JSON.stringify(testResult.result.value, null, 2));

  await disconnect(conn);
}

debugUpdateDraft().catch(console.error);
