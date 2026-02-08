
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function sendDraft() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return { error: "ViewState._composeFormController not found" };
          
          const draftId = "draft0002374702cf9e79";
          const ctrl = cfc[draftId];
          if (!ctrl) return { error: "Draft controller not found for " + draftId };
          
          // Re-verify body one last time
          const body = ctrl.state.draft.body;
          if (!body || body.length < 10) return { error: "Draft body is too short or empty: " + body };

          // Send
          await ctrl._sendDraft();
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

sendDraft();
