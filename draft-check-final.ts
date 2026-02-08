
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function draftAndCheck() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const threadId = "19c1fddba41e2a6e";
          const bodyText = "Hi Robert and Jon, drafting a test reply from the CLI to verify the draft key collision fix again.";
          
          const tree = window.ViewState?.tree;
          if (tree?.set) {
            tree.set(['threadPane', 'threadId'], threadId);
            tree.set(['threadListView', 'threadId'], threadId);
          }
          
          await new Promise(r => setTimeout(r, 500));

          const rc = window.ViewState?.regionalCommands;
          let replyCmd = null;
          for (const region of rc) {
            if (region?.commands) {
              replyCmd = region.commands.find(c => c.id === "REPLY_POP_OUT");
              if (replyCmd) break;
            }
          }

          if (replyCmd) {
            replyCmd.action({ preventDefault: () => {}, stopPropagation: () => {} });
          } else {
            return { error: "REPLY_POP_OUT not found" };
          }

          // Wait for compose
          await new Promise(r => setTimeout(r, 2000));

          const cfc = window.ViewState?._composeFormController;
          const keys = Object.keys(cfc).filter(k => k.startsWith('draft'));
          const newDraftKey = keys[keys.length - 1]; // Assume last created for debug
          
          const ctrl = cfc[newDraftKey];
          const html = "<p>" + bodyText + "</p>";
          
          await ctrl._updateDraft({ body: html });
          
          if (ctrl.state?.draft) {
            ctrl.state.draft.body = html;
          }

          if (typeof ctrl._saveDraftAsync === 'function') {
            await ctrl._saveDraftAsync();
          }

          return {
            success: true,
            keys,
            newDraftKey,
            body: ctrl.state?.draft?.body
          };
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

draftAndCheck();
