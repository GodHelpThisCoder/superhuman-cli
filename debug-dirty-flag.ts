
import { connectToSuperhuman, disconnect, openCompose } from "./src/superhuman-api";

async function debugDirtyFlag() {
  console.log("=== Understanding Dirty Flag ===\n");

  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const draftKey = await openCompose(conn);
  console.log(`1. Opened compose: ${draftKey}`);

  // Check dirty state after each operation
  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const cfc = window.ViewState?._composeFormController;
        const draftKey = ${JSON.stringify(draftKey)};
        const ctrl = cfc[draftKey];

        if (!ctrl) return { error: "No controller" };

        const draft = ctrl.state?.draft;
        const results = [];

        // Initial state
        results.push({
          step: "initial",
          dirty: draft?.dirty,
          isDirty: draft?.isDirty?.()
        });

        // Set subject via setSubject
        ctrl.setSubject("Dirty Test Subject");
        results.push({
          step: "after setSubject",
          dirty: draft?.dirty,
          isDirty: draft?.isDirty?.()
        });

        // Set body via _updateDraft
        ctrl._updateDraft({ body: "<p>Dirty test body</p>" });
        results.push({
          step: "after _updateDraft body",
          dirty: draft?.dirty,
          isDirty: draft?.isDirty?.()
        });

        // Add recipient via _updateDraft
        if (draft?.from?.constructor) {
          const Recipient = draft.from.constructor;
          const newR = new Recipient({ email: "dirty@test.com", name: "", raw: "dirty@test.com" });
          ctrl._updateDraft({ to: [...(draft.to || []), newR] });
        }
        results.push({
          step: "after _updateDraft to",
          dirty: draft?.dirty,
          isDirty: draft?.isDirty?.()
        });

        // Try calling _saveDraftAsync
        await ctrl._saveDraftAsync();
        results.push({
          step: "after _saveDraftAsync",
          dirty: draft?.dirty,
          isDirty: draft?.isDirty?.()
        });

        // Check what isDirty does
        const isDirtySource = draft?.isDirty?.toString?.().substring(0, 400);

        return {
          results,
          isDirtySource
        };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log("2. Dirty flag tracking:");
  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

debugDirtyFlag().catch(console.error);
